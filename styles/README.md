# Styles

Each file here is an instruction the manager can add to a worker's assignment, or
send as a follow-up once the worker is done.

Every style is off by default. Turn one on by saying so:

```text
walkthrough on
walkthrough off
```

While it is on, it applies automatically to the work types in its `applies-to`.
While it is off, you can still ask for it on a single request: "get grok to
implement demo 2, walkthrough".

The toggle lasts for the session.

Frontmatter:

- `name` — what you call it.
- `when` — `after-completion` sends it once the worker reports done.
  `with-assignment` adds it to the assignment instead.
- `applies-to` — the work types it runs for while on: `plan`, `implement`,
  `investigate`, `review`, `fix`. Leave it out and the style only ever runs when
  you name it.

The body is the text sent to the worker. Write it as you would say it.

Add a file, start a new session, and it is available.
