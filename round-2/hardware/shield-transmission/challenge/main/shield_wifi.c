#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

#include "shield_wifi.h"

static const char *TAG = "shield_tx";

#define KRAKOAN_AP_SSID       "Krakoa-Gateway"
#define KRAKOAN_AP_PASSWORD   "44442099"
#define KRAKOAN_CHALLENGE_URL "http://192.168.4.1/challenge"
#define KRAKOAN_VERIFY_URL    "http://192.168.4.1/verify"
#define WIFI_RECONNECT_DELAY_MS 10000
#define WIFI_IP_WAIT_TIMEOUT_MS 30000
#define WIFI_GOT_IP_BIT       BIT0
#define WIFI_HAVE_FLAG_BIT    BIT1
#define WIFI_STOP_AUTO_BIT    BIT2
#define WIFI_FLAG_BUFCAP      96

static EventGroupHandle_t wifi_event_group;
static SemaphoreHandle_t  wifi_flag_mutex;
static char               wifi_flag[WIFI_FLAG_BUFCAP];

static void clear_assigned_flag(void)
{
    xSemaphoreTake(wifi_flag_mutex, portMAX_DELAY);
    wifi_flag[0] = '\0';
    xSemaphoreGive(wifi_flag_mutex);
    xEventGroupClearBits(wifi_event_group, WIFI_HAVE_FLAG_BIT);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        ESP_LOGI(TAG, "wifi: station started, connecting to \"%s\"",
                 KRAKOAN_AP_SSID);
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *e =
            (wifi_event_sta_disconnected_t *)event_data;
        EventBits_t bits = xEventGroupGetBits(wifi_event_group);
        bool intentional = (bits & WIFI_STOP_AUTO_BIT) != 0;
        ESP_LOGI(TAG, "wifi: disconnected (reason=%d)%s",
                 e ? e->reason : -1,
                 intentional ? ", staying down" : ", auto-reconnecting");
        xEventGroupClearBits(wifi_event_group, WIFI_GOT_IP_BIT);
        clear_assigned_flag();
        if (!intentional) {
            esp_wifi_connect();
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "wifi: got IP " IPSTR, IP2STR(&e->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, WIFI_GOT_IP_BIT);
    }
}

static void wifi_init_sta(void)
{
    wifi_event_group = xEventGroupCreate();
    wifi_flag_mutex  = xSemaphoreCreateMutex();
    configASSERT(wifi_event_group != NULL && wifi_flag_mutex != NULL);

    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t er = esp_event_loop_create_default();
    if (er != ESP_OK && er != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(er);
    }
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init_cfg));

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                               &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                               &wifi_event_handler, NULL));

    wifi_config_t sta_cfg = {
        .sta = {
            .ssid = KRAKOAN_AP_SSID,
            .password = KRAKOAN_AP_PASSWORD,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
            .pmf_cfg = {
                .capable = true,
                .required = true,
            },
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
}

static int url_encode(const char *in, char *out, size_t outcap)
{
    static const char hex[] = "0123456789ABCDEF";
    size_t j = 0;
    for (size_t i = 0; in[i] != '\0'; i++) {
        unsigned char c = (unsigned char)in[i];
        bool unreserved = (c >= 'A' && c <= 'Z')
                       || (c >= 'a' && c <= 'z')
                       || (c >= '0' && c <= '9')
                       || c == '-' || c == '_' || c == '.' || c == '~';
        if (unreserved) {
            if (j + 1 >= outcap) return -1;
            out[j++] = (char)c;
        } else {
            if (j + 3 >= outcap) return -1;
            out[j++] = '%';
            out[j++] = hex[(c >> 4) & 0xF];
            out[j++] = hex[c & 0xF];
        }
    }
    if (j >= outcap) return -1;
    out[j] = '\0';
    return (int)j;
}

static esp_err_t fetch_assigned_flag(void)
{
    esp_http_client_config_t cfg = {
        .url        = KRAKOAN_CHALLENGE_URL,
        .method     = HTTP_METHOD_GET,
        .timeout_ms = 5000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (client == NULL) {
        ESP_LOGW(TAG, "wifi: http client init failed");
        return ESP_FAIL;
    }

    esp_err_t err = ESP_FAIL;
    if (esp_http_client_open(client, 0) == ESP_OK) {
        if (esp_http_client_fetch_headers(client) >= 0) {
            int status = esp_http_client_get_status_code(client);
            if (status == 200) {
                char buf[WIFI_FLAG_BUFCAP];
                int n = esp_http_client_read_response(client, buf,
                                                      sizeof(buf) - 1);
                if (n > 0) {
                    buf[n] = '\0';
                    while (n > 0 && (buf[n - 1] == '\n' || buf[n - 1] == '\r'
                                  || buf[n - 1] == ' '  || buf[n - 1] == '\t')) {
                        buf[--n] = '\0';
                    }
                    xSemaphoreTake(wifi_flag_mutex, portMAX_DELAY);
                    strlcpy(wifi_flag, buf, sizeof(wifi_flag));
                    xSemaphoreGive(wifi_flag_mutex);
                    xEventGroupSetBits(wifi_event_group, WIFI_HAVE_FLAG_BIT);
                    ESP_LOGI(TAG, "wifi: received assigned flag: <masked> len=%u",
                             (unsigned)strlen(wifi_flag));
                    err = ESP_OK;
                } else {
                    ESP_LOGW(TAG, "wifi: empty /challenge response");
                }
            } else {
                ESP_LOGW(TAG, "wifi: /challenge returned status=%d", status);
            }
        } else {
            ESP_LOGW(TAG, "wifi: failed to fetch /challenge headers");
        }
    } else {
        ESP_LOGW(TAG, "wifi: failed to open /challenge");
    }
    esp_http_client_cleanup(client);
    return err;
}

static void post_flag_once(void)
{
    char snapshot[WIFI_FLAG_BUFCAP];
    xSemaphoreTake(wifi_flag_mutex, portMAX_DELAY);
    strlcpy(snapshot, wifi_flag, sizeof(snapshot));
    xSemaphoreGive(wifi_flag_mutex);

    if (snapshot[0] == '\0') {
        ESP_LOGW(TAG, "wifi: no assigned flag to post");
        return;
    }

    char encoded[256];
    if (url_encode(snapshot, encoded, sizeof(encoded)) < 0) {
        ESP_LOGW(TAG, "wifi: flag too long to url-encode");
        return;
    }
    char body[320];
    int n = snprintf(body, sizeof(body), "flag=%s", encoded);
    if (n < 0 || n >= (int)sizeof(body)) {
        ESP_LOGW(TAG, "wifi: post body too small");
        return;
    }

    esp_http_client_config_t cfg = {
        .url        = KRAKOAN_VERIFY_URL,
        .method     = HTTP_METHOD_POST,
        .timeout_ms = 5000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (client == NULL) {
        ESP_LOGW(TAG, "wifi: http client init failed");
        return;
    }

    esp_http_client_set_header(client, "Content-Type",
                               "application/x-www-form-urlencoded");
    esp_http_client_set_post_field(client, body, n);

    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ESP_LOGI(TAG, "wifi: POSTed flag to %s (status=%d)",
                 KRAKOAN_VERIFY_URL, status);
    } else {
        ESP_LOGW(TAG, "wifi: POST failed: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(client);
}

static void flag_poster_task(void *arg)
{
    for (;;) {
        EventBits_t bits = xEventGroupWaitBits(
            wifi_event_group, WIFI_GOT_IP_BIT,
            pdFALSE, pdTRUE, pdMS_TO_TICKS(WIFI_IP_WAIT_TIMEOUT_MS));

        if (bits & WIFI_GOT_IP_BIT) {
            if (fetch_assigned_flag() == ESP_OK) {
                post_flag_once();
            }
        } else {
            ESP_LOGW(TAG, "wifi: timed out waiting for IP, restarting cycle");
        }

        ESP_LOGI(TAG, "wifi: tearing down link, sleeping %d ms before reconnect",
                 WIFI_RECONNECT_DELAY_MS);
        xEventGroupSetBits(wifi_event_group, WIFI_STOP_AUTO_BIT);
        esp_wifi_disconnect();

        vTaskDelay(pdMS_TO_TICKS(WIFI_RECONNECT_DELAY_MS));

        xEventGroupClearBits(wifi_event_group, WIFI_STOP_AUTO_BIT);
        ESP_LOGI(TAG, "wifi: initiating fresh association");
        esp_err_t err = esp_wifi_connect();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "wifi: esp_wifi_connect() rc=%s",
                     esp_err_to_name(err));
        }
    }
}

void shield_wifi_start(void)
{
    wifi_init_sta();
    BaseType_t created = xTaskCreate(flag_poster_task, "flag_post", 4096,
                                     NULL, tskIDLE_PRIORITY + 2, NULL);
    if (created != pdPASS) {
        ESP_LOGE(TAG, "wifi: failed to create flag_post task");
    }
}
