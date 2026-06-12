# bit-challenge build
#
#   make        -> bit (stripped, shipped) and bit.dbg (with symbols, kept for solver)
#   make clean

CC      ?= gcc
CFLAGS  ?= -static -no-pie -fstack-protector-all -O0 -Wall

SRC := echo.c
DBG := bit.dbg
BIN := bit

.PHONY: all clean
all: $(BIN) $(DBG)

$(DBG): $(SRC)
	$(CC) $(CFLAGS) -o $@ $<

$(BIN): $(DBG)
	cp $< $@
	strip $@

clean:
	rm -f $(BIN) $(DBG)
