/*
 * Shield Transmission BLE GATT flag broadcaster.
 *
 * Advertises a primary service with a single readable characteristic.
 * Every read of the flag characteristic returns the boot-generated flag in
 * plain text, so any GATT client can retrieve it after connecting.
 */

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_random.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

#include "shield_ble.h"

static const char *TAG = "shield_tx";

#define DEVICE_NAME "Shield-XMIT"
#define FLAG_ENTROPY_BYTES 16
#define FLAG_HALF_ENTROPY_BYTES (FLAG_ENTROPY_BYTES / 2)
#define FLAG_HALF_TEXT_LEN ((FLAG_HALF_ENTROPY_BYTES * 8 + 5) / 6)
#define FLAG_PREFIX "HZU18{"
#define FLAG_MIDDLE ":S.H.1.3.L.D_tr@nsm1ss10n_suCC3ssfu1:"
#define FLAG_SUFFIX "}"
#define FLAG_TEXT_LEN ((sizeof(FLAG_PREFIX) - 1) + FLAG_HALF_TEXT_LEN + \
                       (sizeof(FLAG_MIDDLE) - 1) + FLAG_HALF_TEXT_LEN + \
                       (sizeof(FLAG_SUFFIX) - 1))
#define CONNECTION_TIMEOUT_MS 2000
#define DISCONNECT_AFTER_READ_DELAY_MS 1500
_Static_assert((FLAG_ENTROPY_BYTES % 2) == 0,
               "FLAG_ENTROPY_BYTES must split into equal halves");

static char flag_value[FLAG_TEXT_LEN + 1];

/*
 * Shield Transmission service: 5345484c-4421-5852-4954-000000000001
 *   "SEHL" "D!"  "XR" "IT"
 * Flag characteristic:         5345484c-4421-5852-4954-000000000002
 */
static const ble_uuid128_t shield_svc_uuid = BLE_UUID128_INIT(
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x54, 0x49,
    0x52, 0x58, 0x21, 0x44, 0x4c, 0x48, 0x45, 0x53);

static const ble_uuid128_t shield_flag_chr_uuid = BLE_UUID128_INIT(
    0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x54, 0x49,
    0x52, 0x58, 0x21, 0x44, 0x4c, 0x48, 0x45, 0x53);

static uint16_t flag_chr_val_handle;
static uint8_t own_addr_type;
static uint8_t active_connections;
static uint16_t connection_generation;

struct connection_state {
    uint16_t conn_handle;
    uint16_t generation;
    bool active;
    bool flag_read;
};

static struct connection_state connection_states[CONFIG_BT_NIMBLE_MAX_CONNECTIONS];

static void start_advertising(void);

static uintptr_t connection_task_param(uint16_t conn_handle, uint16_t generation)
{
    return ((uintptr_t)generation << 16) | conn_handle;
}

static uint16_t connection_param_handle(uintptr_t param)
{
    return (uint16_t)(param & 0xffff);
}

static uint16_t connection_param_generation(uintptr_t param)
{
    return (uint16_t)(param >> 16);
}

static struct connection_state *find_connection(uint16_t conn_handle,
                                                uint16_t generation)
{
    for (size_t i = 0; i < CONFIG_BT_NIMBLE_MAX_CONNECTIONS; i++) {
        if (connection_states[i].active &&
            connection_states[i].conn_handle == conn_handle &&
            connection_states[i].generation == generation) {
            return &connection_states[i];
        }
    }

    return NULL;
}

static uint16_t register_connection(uint16_t conn_handle)
{
    connection_generation++;
    if (connection_generation == 0) {
        connection_generation++;
    }

    for (size_t i = 0; i < CONFIG_BT_NIMBLE_MAX_CONNECTIONS; i++) {
        if (!connection_states[i].active) {
            connection_states[i] = (struct connection_state) {
                .conn_handle = conn_handle,
                .generation = connection_generation,
                .active = true,
                .flag_read = false,
            };
            return connection_generation;
        }
    }

    ESP_LOGW(TAG, "no connection state slot for conn=0x%04x", conn_handle);
    return 0;
}

static void unregister_connection(uint16_t conn_handle)
{
    for (size_t i = 0; i < CONFIG_BT_NIMBLE_MAX_CONNECTIONS; i++) {
        if (connection_states[i].active &&
            connection_states[i].conn_handle == conn_handle) {
            connection_states[i].active = false;
            return;
        }
    }
}

static uint16_t mark_flag_read(uint16_t conn_handle)
{
    for (size_t i = 0; i < CONFIG_BT_NIMBLE_MAX_CONNECTIONS; i++) {
        if (connection_states[i].active &&
            connection_states[i].conn_handle == conn_handle) {
            connection_states[i].flag_read = true;
            return connection_states[i].generation;
        }
    }

    ESP_LOGW(TAG, "flag read on unknown conn=0x%04x", conn_handle);
    return 0;
}

static void connection_timeout_task(void *param)
{
    uintptr_t task_param = (uintptr_t)param;
    uint16_t conn_handle = connection_param_handle(task_param);
    uint16_t generation = connection_param_generation(task_param);

    vTaskDelay(pdMS_TO_TICKS(CONNECTION_TIMEOUT_MS));

    struct connection_state *state = find_connection(conn_handle, generation);
    if (state == NULL) {
        vTaskDelete(NULL);
        return;
    }
    if (state->flag_read) {
        ESP_LOGI(TAG, "connection timeout skipped after flag read; conn=0x%04x",
                 conn_handle);
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "connection timeout; conn=0x%04x", conn_handle);
    int rc = ble_gap_terminate(conn_handle, BLE_ERR_REM_USER_CONN_TERM);
    if (rc != 0) {
        ESP_LOGW(TAG, "connection timeout disconnect failed; conn=0x%04x rc=%d",
                 conn_handle, rc);
    }

    vTaskDelete(NULL);
}

static void schedule_connection_timeout(uint16_t conn_handle, uint16_t generation)
{
    BaseType_t created = xTaskCreate(connection_timeout_task,
                                     "conn_tmo",
                                     2048,
                                     (void *)connection_task_param(conn_handle,
                                                                   generation),
                                     tskIDLE_PRIORITY + 1,
                                     NULL);
    if (created != pdPASS) {
        ESP_LOGW(TAG, "connection timeout task create failed; conn=0x%04x",
                 conn_handle);
    }
}

static void disconnect_after_read_task(void *param)
{
    uintptr_t task_param = (uintptr_t)param;
    uint16_t conn_handle = connection_param_handle(task_param);
    uint16_t generation = connection_param_generation(task_param);

    vTaskDelay(pdMS_TO_TICKS(DISCONNECT_AFTER_READ_DELAY_MS));

    if (find_connection(conn_handle, generation) == NULL) {
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "disconnecting after flag read; conn=0x%04x", conn_handle);
    int rc = ble_gap_terminate(conn_handle, BLE_ERR_REM_USER_CONN_TERM);
    if (rc != 0) {
        ESP_LOGW(TAG, "disconnect after read failed; conn=0x%04x rc=%d",
                 conn_handle, rc);
    }

    vTaskDelete(NULL);
}

static void schedule_disconnect_after_read(uint16_t conn_handle,
                                           uint16_t generation)
{
    BaseType_t created = xTaskCreate(disconnect_after_read_task,
                                     "flag_disc",
                                     2048,
                                     (void *)connection_task_param(conn_handle,
                                                                   generation),
                                     tskIDLE_PRIORITY + 1,
                                     NULL);
    if (created != pdPASS) {
        ESP_LOGW(TAG, "disconnect task create failed; conn=0x%04x",
                 conn_handle);
        ble_gap_terminate(conn_handle, BLE_ERR_REM_USER_CONN_TERM);
    }
}

static void encode_base64url(const uint8_t *input, size_t input_len,
                             char *output)
{
    static const char alphabet[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    size_t input_pos = 0;
    size_t output_pos = 0;

    while (input_len - input_pos >= 3) {
        uint32_t chunk = ((uint32_t)input[input_pos] << 16) |
                         ((uint32_t)input[input_pos + 1] << 8) |
                         input[input_pos + 2];

        output[output_pos++] = alphabet[(chunk >> 18) & 0x3f];
        output[output_pos++] = alphabet[(chunk >> 12) & 0x3f];
        output[output_pos++] = alphabet[(chunk >> 6) & 0x3f];
        output[output_pos++] = alphabet[chunk & 0x3f];
        input_pos += 3;
    }

    size_t remaining = input_len - input_pos;
    if (remaining == 1) {
        uint32_t chunk = (uint32_t)input[input_pos] << 16;
        output[output_pos++] = alphabet[(chunk >> 18) & 0x3f];
        output[output_pos++] = alphabet[(chunk >> 12) & 0x3f];
    } else if (remaining == 2) {
        uint32_t chunk = ((uint32_t)input[input_pos] << 16) |
                         ((uint32_t)input[input_pos + 1] << 8);
        output[output_pos++] = alphabet[(chunk >> 18) & 0x3f];
        output[output_pos++] = alphabet[(chunk >> 12) & 0x3f];
        output[output_pos++] = alphabet[(chunk >> 6) & 0x3f];
    }

    output[output_pos] = '\0';
}

static void generate_flag(void)
{
    uint8_t entropy[FLAG_ENTROPY_BYTES];
    char first_half[FLAG_HALF_TEXT_LEN + 1];
    char second_half[FLAG_HALF_TEXT_LEN + 1];

    esp_fill_random(entropy, sizeof(entropy));
    encode_base64url(entropy, FLAG_HALF_ENTROPY_BYTES, first_half);
    encode_base64url(entropy + FLAG_HALF_ENTROPY_BYTES,
                     FLAG_HALF_ENTROPY_BYTES, second_half);

    int written = snprintf(flag_value, sizeof(flag_value), "%s%s%s%s%s",
                           FLAG_PREFIX, first_half, FLAG_MIDDLE, second_half,
                           FLAG_SUFFIX);
    if (written < 0 || (size_t)written != FLAG_TEXT_LEN) {
        ESP_LOGE(TAG, "failed to format generated flag");
        ESP_ERROR_CHECK(ESP_FAIL);
    }

    ESP_LOGI(TAG, "generated flag: <masked> len=%u",
             (unsigned)strlen(flag_value));
}

static int flag_chr_access_cb(uint16_t conn_handle, uint16_t attr_handle,
                              struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op != BLE_GATT_ACCESS_OP_READ_CHR) {
        return BLE_ATT_ERR_REQ_NOT_SUPPORTED;
    }

    ESP_LOGI(TAG, "flag read; conn=0x%04x", conn_handle);
    int rc = os_mbuf_append(ctxt->om, flag_value, strlen(flag_value));
    if (rc != 0) {
        return BLE_ATT_ERR_INSUFFICIENT_RES;
    }

    uint16_t generation = mark_flag_read(conn_handle);
    if (generation != 0) {
        schedule_disconnect_after_read(conn_handle, generation);
    }
    return 0;
}

static const struct ble_gatt_svc_def gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &shield_svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &shield_flag_chr_uuid.u,
                .access_cb = flag_chr_access_cb,
                .flags = BLE_GATT_CHR_F_READ,
                .val_handle = &flag_chr_val_handle,
            },
            { 0 },
        },
    },
    { 0 },
};

static int gap_event_cb(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        ESP_LOGI(TAG, "connect %s; status=%d",
                 event->connect.status == 0 ? "established" : "failed",
                 event->connect.status);
        if (event->connect.status == 0) {
            active_connections++;
            ESP_LOGI(TAG, "active connections: %u/%u",
                     active_connections, CONFIG_BT_NIMBLE_MAX_CONNECTIONS);
            uint16_t generation =
                register_connection(event->connect.conn_handle);
            if (generation != 0) {
                schedule_connection_timeout(event->connect.conn_handle,
                                            generation);
            }
        } else {
            ESP_LOGW(TAG, "connect failed; restarting advertising");
        }
        start_advertising();
        break;

    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "disconnect; reason=%d", event->disconnect.reason);
        if (active_connections > 0) {
            active_connections--;
        }
        unregister_connection(event->disconnect.conn.conn_handle);
        ESP_LOGI(TAG, "active connections: %u/%u",
                 active_connections, CONFIG_BT_NIMBLE_MAX_CONNECTIONS);
        start_advertising();
        break;

    case BLE_GAP_EVENT_ADV_COMPLETE:
        ESP_LOGI(TAG, "adv complete; reason=%d", event->adv_complete.reason);
        start_advertising();
        break;

    case BLE_GAP_EVENT_SUBSCRIBE:
        ESP_LOGI(TAG, "subscribe; conn=0x%04x attr=0x%04x",
                 event->subscribe.conn_handle, event->subscribe.attr_handle);
        break;

    default:
        break;
    }
    return 0;
}

static void start_advertising(void)
{
    if (ble_gap_adv_active()) {
        return;
    }

    struct ble_hs_adv_fields fields = {0};
    const char *name = ble_svc_gap_device_name();

    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.tx_pwr_lvl_is_present = 1;
    fields.tx_pwr_lvl = BLE_HS_ADV_TX_PWR_LVL_AUTO;
    fields.name = (uint8_t *)name;
    fields.name_len = strlen(name);
    fields.name_is_complete = 1;

    int rc = ble_gap_adv_set_fields(&fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_set_fields rc=%d", rc);
        return;
    }

    struct ble_hs_adv_fields rsp_fields = {0};
    rsp_fields.uuids128 = (ble_uuid128_t *)&shield_svc_uuid;
    rsp_fields.num_uuids128 = 1;
    rsp_fields.uuids128_is_complete = 1;

    rc = ble_gap_adv_rsp_set_fields(&rsp_fields);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_rsp_set_fields rc=%d", rc);
        return;
    }

    struct ble_gap_adv_params adv_params = {
        .conn_mode = BLE_GAP_CONN_MODE_UND,
        .disc_mode = BLE_GAP_DISC_MODE_GEN,
    };

    rc = ble_gap_adv_start(own_addr_type, NULL, BLE_HS_FOREVER,
                           &adv_params, gap_event_cb, NULL);
    if (rc != 0) {
        ESP_LOGE(TAG, "adv_start rc=%d", rc);
        return;
    }

    ESP_LOGI(TAG, "advertising as \"%s\"", name);
}

static void on_sync(void)
{
    int rc = ble_hs_util_ensure_addr(0);
    if (rc != 0) {
        ESP_LOGE(TAG, "ensure_addr rc=%d", rc);
        return;
    }

    rc = ble_hs_id_infer_auto(0, &own_addr_type);
    if (rc != 0) {
        ESP_LOGE(TAG, "infer_auto rc=%d", rc);
        return;
    }

    uint8_t addr[6] = {0};
    rc = ble_hs_id_copy_addr(own_addr_type, addr, NULL);
    if (rc == 0) {
        ESP_LOGI(TAG, "device addr %02x:%02x:%02x:%02x:%02x:%02x",
                 addr[5], addr[4], addr[3], addr[2], addr[1], addr[0]);
    }

    start_advertising();
}

static void on_reset(int reason)
{
    ESP_LOGE(TAG, "host reset; reason=%d", reason);
}

static void host_task(void *param)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

static void register_gatt(void)
{
    ble_svc_gap_init();
    ble_svc_gatt_init();

    int rc = ble_gatts_count_cfg(gatt_svcs);
    ESP_ERROR_CHECK(rc == 0 ? ESP_OK : ESP_FAIL);

    rc = ble_gatts_add_svcs(gatt_svcs);
    ESP_ERROR_CHECK(rc == 0 ? ESP_OK : ESP_FAIL);

    ESP_ERROR_CHECK(ble_svc_gap_device_name_set(DEVICE_NAME));
}

void shield_ble_start(void)
{
    ESP_ERROR_CHECK(nimble_port_init());
    generate_flag();

    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;

    register_gatt();
    nimble_port_freertos_init(host_task);
}
