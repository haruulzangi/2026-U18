#include "krakoa_server.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

#include "esp_log.h"

#include "krakoa_wifi.h"

static const char *TAG = "krakoa_server";

static int url_decode(const char *in, int inlen, char *out, int outcap)
{
    int i = 0, j = 0;
    while (i < inlen && j + 1 < outcap) {
        char c = in[i];
        if (c == '+') {
            out[j++] = ' ';
            i++;
        } else if (c == '%' && i + 2 < inlen) {
            char h1 = in[i + 1];
            char h2 = in[i + 2];
            int v1 = (h1 >= '0' && h1 <= '9') ? h1 - '0'
                   : (h1 >= 'a' && h1 <= 'f') ? h1 - 'a' + 10
                   : (h1 >= 'A' && h1 <= 'F') ? h1 - 'A' + 10 : -1;
            int v2 = (h2 >= '0' && h2 <= '9') ? h2 - '0'
                   : (h2 >= 'a' && h2 <= 'f') ? h2 - 'a' + 10
                   : (h2 >= 'A' && h2 <= 'F') ? h2 - 'A' + 10 : -1;
            if (v1 < 0 || v2 < 0) {
                return -1;
            }
            out[j++] = (char)((v1 << 4) | v2);
            i += 3;
        } else {
            out[j++] = c;
            i++;
        }
    }
    out[j] = '\0';
    return j;
}

static bool const_time_eq(const char *a, const char *b, size_t n)
{
    unsigned int diff = 0;
    for (size_t i = 0; i < n; i++) {
        diff |= (unsigned char)a[i] ^ (unsigned char)b[i];
    }
    return diff == 0;
}

static bool resolve_peer_ipv4(int sockfd, uint32_t *out_ip)
{
    struct sockaddr_storage ss;
    socklen_t sl = sizeof(ss);
    if (getpeername(sockfd, (struct sockaddr *)&ss, &sl) != 0) {
        return false;
    }
    if (ss.ss_family == AF_INET) {
        *out_ip = ((struct sockaddr_in *)&ss)->sin_addr.s_addr;
        return true;
    }
    if (ss.ss_family == AF_INET6) {
        struct sockaddr_in6 *sa6 = (struct sockaddr_in6 *)&ss;
        const uint8_t *b = sa6->sin6_addr.s6_addr;
        bool v4mapped = b[10] == 0xff && b[11] == 0xff;
        if (v4mapped) {
            *out_ip = ((uint32_t)b[12])
                    | ((uint32_t)b[13] << 8)
                    | ((uint32_t)b[14] << 16)
                    | ((uint32_t)b[15] << 24);
            return true;
        }
    }
    return false;
}

static bool resolve_client_mac(httpd_req_t *req, uint8_t mac_out[6])
{
    int sockfd = httpd_req_to_sockfd(req);
    uint32_t ip = 0;
    if (!resolve_peer_ipv4(sockfd, &ip)) {
        return false;
    }
    return krakoa_wifi_get_mac_for_ip(ip, mac_out);
}

static esp_err_t challenge_handler(httpd_req_t *req)
{
    uint8_t mac[6];
    if (!resolve_client_mac(req, mac)) {
        return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN,
                                   "could not identify caller");
    }

    char flag_copy[KRAKOA_FLAG_BUFCAP];
    if (!krakoa_wifi_get_flag_for_mac(mac, flag_copy, sizeof(flag_copy))) {
        return httpd_resp_send_err(req, HTTPD_404_NOT_FOUND,
                                   "no flag for this station");
    }

    ESP_LOGI(TAG, "issued flag to %02x:%02x:%02x:%02x:%02x:%02x via /challenge",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, flag_copy, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t form_handler(httpd_req_t *req)
{
    static const char body[] =
        "<!doctype html><meta charset=\"utf-8\">"
        "<title>Krakoa-Gateway</title>"
        "<style>body{font-family:monospace;max-width:680px;margin:2em auto;"
        "padding:0 1em}input[name=flag]{width:100%;padding:.5em;"
        "font-family:monospace}button{padding:.5em 1em;margin-top:.5em}</style>"
        "<h1>Hand Cell // Tactical Channel</h1>"
        "<p>Submit the operational callsign assigned to your handset:</p>"
        "<form method=\"POST\" action=\"/verify\" accept-charset=\"utf-8\">"
        "<input name=\"flag\" type=\"text\" autocomplete=\"off\" autofocus "
        "placeholder=\"HZU18{...}\">"
        "<br><button type=\"submit\">verify</button>"
        "</form>"
        "<p><small>Connected handsets can fetch their callsign from "
        "<code>/challenge</code>.</small></p>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t verify_handler(httpd_req_t *req)
{
    char raw[256];
    int total = req->content_len;
    if (total <= 0 || total > (int)sizeof(raw) - 1) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                                   "payload missing or too large");
    }

    int got = 0;
    while (got < total) {
        int r = httpd_req_recv(req, raw + got, total - got);
        if (r <= 0) {
            if (r == HTTPD_SOCK_ERR_TIMEOUT) {
                continue;
            }
            return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR,
                                       "recv failed");
        }
        got += r;
    }
    raw[got] = '\0';

    const char *p = strstr(raw, "flag=");
    if (!p) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                                   "missing flag field");
    }
    p += 5;
    const char *end = strchr(p, '&');
    int field_len = end ? (int)(end - p) : (int)strlen(p);

    char decoded[256];
    int dlen = url_decode(p, field_len, decoded, sizeof(decoded));
    if (dlen < 0) {
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                                   "bad url-encoding");
    }

    uint8_t mac[6];
    if (!resolve_client_mac(req, mac)) {
        return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "unknown caller");
    }

    char expected[KRAKOA_FLAG_BUFCAP];
    bool have_expected =
        krakoa_wifi_get_flag_for_mac(mac, expected, sizeof(expected));

    bool ok = false;
    if (have_expected) {
        size_t exp_len = strlen(expected);
        ok = ((size_t)dlen == exp_len)
          && const_time_eq(decoded, expected, exp_len);
    }

    ESP_LOGI(TAG, "verify from %02x:%02x:%02x:%02x:%02x:%02x: %s",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
             ok ? "ACCEPT" : "REJECT");

    httpd_resp_set_type(req, "text/html");
    if (ok) {
        const char body[] =
            "<!doctype html><meta charset=\"utf-8\">"
            "<title>Krakoa-Gateway</title>"
            "<style>body{font-family:monospace;max-width:680px;margin:2em auto;"
            "padding:0 1em;color:#0a0}</style>"
            "<h1>Callsign verified</h1>"
            "<p>Operational callsign accepted. Strike package authorized.</p>"
            "<p><a href=\"/\">back</a></p>";
        return httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
    }

    const char body[] =
        "<!doctype html><meta charset=\"utf-8\">"
        "<title>Krakoa-Gateway</title>"
        "<style>body{font-family:monospace;max-width:680px;margin:2em auto;"
        "padding:0 1em;color:#a00}</style>"
        "<h1>Callsign rejected</h1>"
        "<p>Authentication failure. Strike package denied.</p>"
        "<p><a href=\"/\">retry</a></p>";
    return httpd_resp_send(req, body, HTTPD_RESP_USE_STRLEN);
}

httpd_handle_t krakoa_server_start(void)
{
    httpd_handle_t server = NULL;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 80;
    config.lru_purge_enable = true;
    config.uri_match_fn = httpd_uri_match_wildcard;

    if (httpd_start(&server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "failed to start HTTP server");
        return NULL;
    }

    static const httpd_uri_t form_get = {
        .uri      = "/",
        .method   = HTTP_GET,
        .handler  = form_handler,
        .user_ctx = NULL,
    };
    static const httpd_uri_t challenge_get = {
        .uri      = "/challenge",
        .method   = HTTP_GET,
        .handler  = challenge_handler,
        .user_ctx = NULL,
    };
    static const httpd_uri_t verify_post = {
        .uri      = "/verify",
        .method   = HTTP_POST,
        .handler  = verify_handler,
        .user_ctx = NULL,
    };
    httpd_register_uri_handler(server, &form_get);
    httpd_register_uri_handler(server, &challenge_get);
    httpd_register_uri_handler(server, &verify_post);

    ESP_LOGI(TAG, "HTTP server listening on :80");
    return server;
}
