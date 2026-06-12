idf_component_register(
    SRCS "main.c" "krakoa_server.c" "krakoa_wifi.c"
    INCLUDE_DIRS "."
    REQUIRES nvs_flash esp_wifi esp_event esp_http_server esp_netif
)
