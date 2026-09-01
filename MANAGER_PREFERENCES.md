# Manager preferences

## Work in reality-tested vertical slices

- Build in small vertical slices that pass through the real system rather than completing one architectural layer at a time.
- Every slice must put something real in the user’s hands: a command they can run, an interface they can use, output they can inspect, or an end-to-end behavior they can observe.
- A slice is not complete merely because its automated tests pass. Automated tests are necessary, but the user must also have a concrete way to exercise the result and evaluate whether it is useful.
- State the user-facing acceptance path before implementing a slice. Keep it short and specific, for example: run `/worker-demo`, observe a detached planning job complete, and inspect its result with `/worker-status`.
- Prefer the smallest end-to-end capability that touches reality over a larger collection of internally complete abstractions.
- Avoid building substantial infrastructure ahead of a usable path through it. Code that is well tested but has not yet participated in real behavior carries integration and product risk.
- After each slice, pause for user feedback before expanding the design. Use what was observed in practice to choose and shape the next slice.
- Keep each subsequent slice usable. Extend the working path without replacing it with a long period during which only internal components can be tested.

The strategy is to establish a visible, usable walking skeleton early and improve it through repeated cycles:

1. Choose one small user-observable outcome.
2. Implement the minimum end-to-end path that produces it.
3. Verify it with automated tests.
4. Put it in the user’s hands with clear instructions for trying it.
5. Gather feedback and use it to select the next slice.
