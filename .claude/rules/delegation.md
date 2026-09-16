# Who writes the code

When Adam asks for code to be written or changed under `client/` or
`backend/ai/`, delegate it to the **builder** subagent
(`.claude/agents/builder.md`) rather than writing it in the main session.

The builder runs Sonnet 5 at high effort with the frontend-design and
test-driven-development skills already loaded, and it knows the project's design
tokens and ownership boundaries.

Do not delegate:

- questions, explanations and reviews — answer those directly, as his mentor
- specs, plans and design documents — those are collaborative, not coding
- anything under `backend/` outside `ai/` — that is Adam's own work and nobody
  writes it for him

To be certain the builder runs, Adam can address it directly:

```
@"builder (agent)" add the chat input to /home
```

## No unrequested delegation

Never spawn **any** subagent (`qa-lead`, `qa-tester`, `builder`, `Explore`, or
otherwise) unless Adam's message explicitly asks for that agent, or leaves no
other reasonable reading. A task falling inside a subagent's documented scope —
e.g. `qa-lead` owns the test specs under `qa/` — is not itself a request to
delegate.
Writing a doc, answering a question, or making an edit that a subagent
*could* do is not the same as being asked to hand it to that subagent.

If delegating looks like the better approach, say so and wait for Adam's
approval before spawning anything. Do not decide unilaterally and spawn an
agent — it spends his tokens on work he did not ask for.
