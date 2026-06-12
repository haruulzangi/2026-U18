import os
import time
import random

random.seed(int(time.time()))
score = 1
print('Welcome!')

while True:
    print('\nOptions:\n1. Double or nothing\n2. Finish game\n> ', end='')
    if input() == '1':
        if random.randint(0, 1) == 1:
            score *= 2
            print(f'Doubled! Balance: {score}')
        else:
            score = 0
            print(f'Nothing! Balance: {score}')
        continue
    if score >= 1337:
        print('Flag: ', os.environ['FLAG'])
    else:
        print('Thanks for playing')
    break
