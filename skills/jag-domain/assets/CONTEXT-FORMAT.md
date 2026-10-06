<!-- Original workflow by Matt Pocock; modified for Pi by pi-orchestraitor. -->

# CONTEXT.md Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Single vs multi-context repos

**Single context (most repos):** Default to `.ai/domain/CONTEXT.md` only when documentation writes are authorized and no conflicting canonical vocabulary exists.

**Multiple contexts:** Default to `.ai/domain/CONTEXT-MAP.md` with each vocabulary at `.ai/domain/contexts/<context>/CONTEXT.md`. The map lists the contexts, locations and relationships:

```md
# Context Map

## Contexts

- [Ordering](./contexts/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./contexts/billing/CONTEXT.md) — generates invoices and processes payments
- [Fulfillment](./contexts/fulfillment/CONTEXT.md) — manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

Inspect authoritative root/context documents and existing maps before choosing a default. Read a canonical map to find contexts wherever it lives. If authority or location conflicts, ask before writing; never migrate/delete documents or create a competing glossary automatically.

If no canonical vocabulary exists, create the applicable default lazily after the first resolved term and write authorization. Read-only requests return definitions inline. When the relevant context is unclear, ask. Keep ADRs outside vocabulary files.
