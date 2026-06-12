# /// script
# dependencies = ['pycryptodome']
# ///
from Crypto.Util.number import bytes_to_long as b2l
from Crypto.Util.number import getPrime

m = b2l(b'HZU18{REDACTED}')

e = 0x10001
p = getPrime(128)
q = getPrime(128)
n = p * q

c = pow(m, e, n)
print('n =', n)
print('c =', c)

# n = 45411006445060042353164621418765092353963836613838954093050211288692449212689
# c = 7360556214758968265745493431745842180444459412838052076718693188771765998590
