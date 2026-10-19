# Marks wait for a prompt change that happens anyway

Foreshadowing clues and triggers were never marked done, so the plan asked the model to plant the same clue in every message for hundreds of messages (Paragon chat, 2026-10-19: 0 planted, 0 fired across 6 arcs and about 980 messages). The model now marks them with `:PLANTED` and `:FIRED` markers, the same recognition mechanism as beats. A marked item leaves the plan and the plant check, and with this provider any changed byte of the injection is a full prompt-cache miss, at `IN_PROMPT` and at depth 0 alike. So marks are queued and applied only when the prompt changes anyway, which is the message in which a beat completes, or when the oldest queued mark has waited 20 messages. Until then the item stays visible and a repeated marker for it is ignored. Secrets get no marker, because the recognition line would have to state the secret right before the reply; they are marked by hand in the Arc Manager, where every toggle costs one miss.

## Considered options

- Apply each mark at once: one cache miss per planted clue, several per episode.
- Show each clue for a fixed number of messages: does not know whether the clue was planted.
- A separate LLM check every N messages: an extra call on the generation profile; kept in reserve if markers prove unreliable.
