# /// script
# dependencies = ['pycryptodome']
# ///
from secrets import randbelow
from Crypto.Util.number import bytes_to_long as b2l

g = lambda: 0

def generate_taps():
    result = [-1]

    while len(result) < 32:
        k = randbelow(327)
        if k not in result:
            result += [k]

    return result


def lfsr():
    global g
    new = 0
    for i in g.taps:
        new ^= g.state[i]
    result = g.state[-1]
    g.state = [new] + g.state[:-1]
    return result


flag = b'HZU18{REDACTED}'
g.taps = generate_taps()
g.state = [int(i) for i in f'{b2l(flag):0328b}']
assert len(flag) == 41

for _ in range(1337):
    lfsr()

bits = ''.join([str(lfsr()) for _ in range(656)])
print(int(bits, 2))

# 243505611407183384826293277811592062025773741635116621090738561950478520083702437700829638399849520046241564352189487595616670557047543574171979448004695893390178826122504465704408432817693120481480
