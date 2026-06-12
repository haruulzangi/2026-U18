# CTFd export

Each subdirectory here is a **CTFd challenge** in
[`ctfcli`](https://github.com/CTFd/ctfcli) format. The actual puzzles run on
the [Weird Flowchart](../README.md) platform (the web app served by the
`docker compose` stack in this repo) — the `challenge.yml` files just wire
the challenge metadata and flag into CTFd so kids earn points for solving
them.

## Layout

```
challenge/
  hello-world/
    challenge.yml   # "Hello World! (no bad chars)" (300 pts)
  square/
    challenge.yml   # "Square of N (scanf/printf)" (400 pts)
  isequal/
    challenge.yml   # "isEqual (branchless compare)" (500 pts)
```

## Pushing to CTFd with ctfcli

From the repository root, set your CTFd token and URL, then run:

```bash
pip install ctfcli
ctf init                                 # first time only — creates .ctf/
ctf challenge install challenge/hello-world/challenge.yml
ctf challenge install challenge/square/challenge.yml
ctf challenge install challenge/isequal/challenge.yml
```

Or push them all in a loop:

```bash
for d in challenge/*/; do
  ctf challenge install "$d/challenge.yml"
done
```

## Hosting the platform

Each challenge description tells kids to "open the URL your instructor
provided". Host the Weird Flowchart web app somewhere reachable by
participants (e.g. with `docker compose up -d` from the repo root and a
reverse proxy / tunnel), and tell them the URL at event kickoff. The
platform itself serves all three challenges; CTFd is just the point
tracker + flag gate.

## Flags

Flags are defined in both places:

- **Server** (`server/src/challenges/*.json` inside the platform image) —
  the platform hands a kid a flag after a correct submission.
- **CTFd** (these `challenge.yml` files) — kids paste that flag into
  CTFd to earn the points.

If you change a flag, update **both** places so they stay in sync.
