#ifndef KRAKOA_WIFI_H
#define KRAKOA_WIFI_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define KRAKOA_FLAG_BUFCAP 96

void krakoa_wifi_init_softap(void);
bool krakoa_wifi_get_mac_for_ip(uint32_t ip, uint8_t mac_out[6]);
bool krakoa_wifi_get_flag_for_mac(const uint8_t mac[6],
                                  char *flag_out,
                                  size_t flag_out_cap);

#endif
