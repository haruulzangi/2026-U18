idf_component_register(
    SRCS "shield_transmission.c" "shield_ble.c" "shield_wifi.c"
    INCLUDE_DIRS "."
    REQUIRES bt nvs_flash esp_event esp_hw_support esp_wifi esp_netif esp_http_client
)
