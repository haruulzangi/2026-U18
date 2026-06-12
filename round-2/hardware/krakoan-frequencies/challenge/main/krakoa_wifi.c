#include "krakoa_wifi.h"

#include <stdio.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "esp_wifi_ap_get_sta_list.h"

#define AP_SSID       "Krakoa-Gateway"
#define AP_PASSWORD   "44442099"
#define AP_CHANNEL    6
#define AP_MAX_CONN   4

#define FLAG_PREFIX   "HZU18{"
#define FLAG_MIDDLE   ":wp@_h@ndsh@k3_cr@cked_by_squ1rr3l_g1rl:"
#define FLAG_SUFFIX   "}"
#define FLAG_HALF_LEN 11

static const char *TAG = "krakoa_wifi";

typedef struct {
    bool     active;
    uint8_t  mac[6];
    char     flag[KRAKOA_FLAG_BUFCAP];
} station_slot_t;

static station_slot_t   stations[AP_MAX_CONN];
static SemaphoreHandle_t stations_mutex;

static const char b64url_alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

static void base64url_encode(const uint8_t *in, size_t inlen, char *out)
{
    size_t i = 0, j = 0;
    while (i + 3 <= inlen) {
        uint32_t v = ((uint32_t)in[i] << 16)
                   | ((uint32_t)in[i + 1] << 8)
                   |  (uint32_t)in[i + 2];
        out[j++] = b64url_alphabet[(v >> 18) & 0x3F];
        out[j++] = b64url_alphabet[(v >> 12) & 0x3F];
        out[j++] = b64url_alphabet[(v >> 6)  & 0x3F];
        out[j++] = b64url_alphabet[ v        & 0x3F];
        i += 3;
    }
    if (i < inlen) {
        uint32_t v = (uint32_t)in[i] << 16;
        if (i + 1 < inlen) {
            v |= (uint32_t)in[i + 1] << 8;
        }
        out[j++] = b64url_alphabet[(v >> 18) & 0x3F];
        out[j++] = b64url_alphabet[(v >> 12) & 0x3F];
        if (i + 1 < inlen) {
            out[j++] = b64url_alphabet[(v >> 6) & 0x3F];
        }
    }
    out[j] = '\0';
}

static void make_random_flag(char *out, size_t outcap)
{
    uint8_t entropy[16];
    char left[FLAG_HALF_LEN + 1];
    char right[FLAG_HALF_LEN + 1];
    esp_fill_random(entropy, sizeof(entropy));
    base64url_encode(entropy, 8, left);
    base64url_encode(entropy + 8, 8, right);
    snprintf(out, outcap, "%s%s%s%s%s",
             FLAG_PREFIX, left, FLAG_MIDDLE, right, FLAG_SUFFIX);
}

static int slot_for_mac_locked(const uint8_t mac[6])
{
    for (int i = 0; i < AP_MAX_CONN; i++) {
        if (stations[i].active && memcmp(stations[i].mac, mac, 6) == 0) {
            return i;
        }
    }
    return -1;
}

static int slot_alloc_locked(const uint8_t mac[6])
{
    int slot = slot_for_mac_locked(mac);
    if (slot >= 0) {
        return slot;
    }
    for (int i = 0; i < AP_MAX_CONN; i++) {
        if (!stations[i].active) {
            return i;
        }
    }
    return -1;
}

static void on_ap_sta_connected(const uint8_t mac[6])
{
    xSemaphoreTake(stations_mutex, portMAX_DELAY);
    int slot = slot_alloc_locked(mac);
    if (slot >= 0) {
        memcpy(stations[slot].mac, mac, 6);
        stations[slot].active = true;
        make_random_flag(stations[slot].flag, sizeof(stations[slot].flag));
        ESP_LOGI(TAG, "STA %02x:%02x:%02x:%02x:%02x:%02x associated; "
                      "issued flag <masked>",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    } else {
        ESP_LOGW(TAG, "no free slot for STA %02x:%02x:%02x:%02x:%02x:%02x",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }
    xSemaphoreGive(stations_mutex);
}

static void on_ap_sta_disconnected(const uint8_t mac[6])
{
    xSemaphoreTake(stations_mutex, portMAX_DELAY);
    int slot = slot_for_mac_locked(mac);
    if (slot >= 0) {
        stations[slot].active = false;
        memset(stations[slot].flag, 0, sizeof(stations[slot].flag));
        ESP_LOGI(TAG, "STA %02x:%02x:%02x:%02x:%02x:%02x disassociated; "
                      "slot freed",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }
    xSemaphoreGive(stations_mutex);
}

static void wifi_event_handler(void *arg, esp_event_base_t base,
                               int32_t event_id, void *data)
{
    if (base != WIFI_EVENT) {
        return;
    }
    if (event_id == WIFI_EVENT_AP_STACONNECTED) {
        wifi_event_ap_staconnected_t *e =
            (wifi_event_ap_staconnected_t *)data;
        on_ap_sta_connected(e->mac);
    } else if (event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        wifi_event_ap_stadisconnected_t *e =
            (wifi_event_ap_stadisconnected_t *)data;
        on_ap_sta_disconnected(e->mac);
    }
}

bool krakoa_wifi_get_mac_for_ip(uint32_t ip, uint8_t mac_out[6])
{
    wifi_sta_list_t        wsl = {0};
    wifi_sta_mac_ip_list_t mil = {0};
    if (esp_wifi_ap_get_sta_list(&wsl) != ESP_OK) {
        return false;
    }
    if (esp_wifi_ap_get_sta_list_with_ip(&wsl, &mil) != ESP_OK) {
        return false;
    }
    for (int i = 0; i < mil.num; i++) {
        if (mil.sta[i].ip.addr == ip) {
            memcpy(mac_out, mil.sta[i].mac, 6);
            return true;
        }
    }
    return false;
}

bool krakoa_wifi_get_flag_for_mac(const uint8_t mac[6],
                                  char *flag_out,
                                  size_t flag_out_cap)
{
    if (flag_out_cap == 0) {
        return false;
    }

    bool found = false;
    xSemaphoreTake(stations_mutex, portMAX_DELAY);
    int slot = slot_for_mac_locked(mac);
    if (slot >= 0) {
        strlcpy(flag_out, stations[slot].flag, flag_out_cap);
        found = true;
    }
    xSemaphoreGive(stations_mutex);

    return found;
}

void krakoa_wifi_init_softap(void)
{
    stations_mutex = xSemaphoreCreateMutex();
    configASSERT(stations_mutex != NULL);

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                               &wifi_event_handler, NULL));

    wifi_config_t ap_cfg = {
        .ap = {
            .ssid           = AP_SSID,
            .ssid_len       = strlen(AP_SSID),
            .channel        = AP_CHANNEL,
            .password       = AP_PASSWORD,
            .max_connection = AP_MAX_CONN,
            .authmode       = WIFI_AUTH_WPA2_PSK,
            .pairwise_cipher = WIFI_CIPHER_TYPE_CCMP,
            .pmf_cfg        = { .required = true },
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "softAP up: SSID=\"%s\" PSK=\"%s\" ch=%d",
             AP_SSID, AP_PASSWORD, AP_CHANNEL);
}
