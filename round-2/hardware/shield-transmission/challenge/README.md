# Shield Transmission

ESP32-C3 firmware that runs a NimBLE GATT server. The device advertises a
single primary service whose only characteristic returns a boot-generated flag
in plain text on every read. Advertising restarts after each accepted
connection so multiple centrals can stay connected and read the characteristic
in parallel until each one reads the flag.

| | |
|---|---|
| Target          | `esp32c3` |
| Device name     | `Shield-XMIT` |
| Service UUID    | `5345484c-4421-5852-4954-000000000001` |
| Flag char UUID  | `5345484c-4421-5852-4954-000000000002` |
| Char properties | `READ` |
| Max connections | `4` |
| Flag format     | `HZU18{<rand_half_1>:S.H.1.3.L.D_tr@nsm1ss10n_suCC3ssfu1:<rand_half_2>}` |

The flag is generated at boot from 16 random bytes. Each 8-byte half is
base64url encoded without padding and kept stable until the device restarts.

## Build

Requires ESP-IDF v5.1 or newer with the ESP32-C3 toolchain installed.

```sh
. $IDF_PATH/export.sh
idf.py set-target esp32c3
idf.py build
```

Flash encryption is enabled in development mode. On first boot, the bootloader
will generate the flash encryption key, program the required eFuses, and encrypt
the flashed bootloader, partition table, app image, and NVS key partition.

## Flash & monitor

Plug an ESP32-C3 board (e.g. ESP32-C3-DevKitM-1) and run:

```sh
idf.py -p /dev/ttyUSB0 flash monitor
```

Logs mask flag values, print the resolved BLE address, and include a line for
every read of the flag characteristic. After a successful flag read, the firmware
disconnects that central after a short delay. Connections also have a 2-second
timeout even if the flag is never read.

## Solving

Any GATT-capable client works. With BlueZ on Linux:

```sh
bluetoothctl
> scan on
> connect <Shield-XMIT addr>
> menu gatt
> select-attribute 5345484c-4421-5852-4954-000000000002
> read
```

Or with `gatttool`:

```sh
gatttool -b <addr> --char-read --uuid=5345484c-4421-5852-4954-000000000002
```

On Android, the **nRF Connect** app discovers the service and reads the
characteristic directly.
