# byte-challenge build
#
#   make        -> byte (stripped, shipped) and byte.dbg (with symbols, kept for solver)
#   make clean

CC      ?= gcc
CFLAGS  ?= -static -no-pie -fno-stack-protector -O0 -Wall

SRC := echo.c
DBG := byte.dbg
BIN := byte

.PHONY: all clean
all: $(BIN) $(DBG)

$(DBG): $(SRC)
	$(CC) $(CFLAGS) -o $@ $<

$(BIN): $(DBG)
	cp $< $@
	strip $@

clean:
	rm -f $(BIN) $(DBG)
