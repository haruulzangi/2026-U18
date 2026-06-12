# --- builder: assemble + link the qword binary -----------------------
FROM ubuntu:24.04 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends binutils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY src ./src
RUN as --64 -o src/qword.o src/qword.S \
 && ld -static -o qword.dbg src/qword.o \
 && cp qword.dbg qword \
 && strip qword

# --- runtime: minimal, hardened, fronted by socat --------------------
FROM ubuntu:24.04 AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 socat coreutils \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd -r chal && useradd -r -g chal -s /bin/sh -m chal

COPY --from=builder /build/qword /chal/qword
COPY run.py                       /chal/run.py
COPY entrypoint.sh                /entrypoint.sh

RUN chown root:root /chal /chal/qword /chal/run.py /entrypoint.sh \
 && chmod 0755 /chal /chal/qword /chal/run.py /entrypoint.sh \
 && ln -s /tmp/flag /flag

USER chal
WORKDIR /tmp

EXPOSE 1337

ENTRYPOINT ["/entrypoint.sh"]
