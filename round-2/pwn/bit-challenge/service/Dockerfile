# --- builder: compile the bit binary --------------------------------
FROM ubuntu:24.04 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        gcc libc6-dev binutils make \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY src ./src
RUN make -C src \
 && cp src/bit bit \
 && cp src/bit.dbg bit.dbg

# --- runtime: minimal, hardened, fronted by socat -------------------
FROM ubuntu:24.04 AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 socat coreutils \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd -r chal && useradd -r -g chal -s /bin/sh -m chal

COPY --from=builder /build/bit  /chal/bit
COPY run.py                     /chal/run.py
COPY entrypoint.sh              /entrypoint.sh

RUN chown root:root /chal /chal/bit /chal/run.py /entrypoint.sh \
 && chmod 0755 /chal /chal/bit /chal/run.py /entrypoint.sh \
 && ln -s /tmp/flag /flag

USER chal
WORKDIR /tmp

EXPOSE 1337

ENTRYPOINT ["/entrypoint.sh"]
