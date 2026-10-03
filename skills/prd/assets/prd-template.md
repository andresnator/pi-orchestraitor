# Technical PRD: {PRODUCT_NAME}

> **Version**: {VERSION} | **Author**: {AUTHOR} | **Date**: {DATE} | **Status**: {STATUS}

## 1. Overview

### Problem

{Who has the problem, what hurts today, current workaround, and why this matters now.}

### Proposed Outcome

{One concise description of the desired end state and product value.}

### Scope

- **In scope**: {features, flows, users, systems, or decisions covered}
- **Out of scope**: {explicit exclusions that prevent scope creep}
- **Stakeholders**: {teams, approvers, owners, or reviewers}
- **Assumptions**: {known assumptions that influence the PRD}

## 2. Goals and Success

### Goals

- **G1**: {goal and why it matters}
- **G2**: {goal and why it matters}

### Success Metrics

| Metric | Baseline | Target | How Measured | Owner |
| --- | --- | --- | --- | --- |
| {metric} | {current or TBD} | {target} | {method/source} | {owner} |

### Non-Goals

- {What this effort intentionally will not solve}

## 3. Users and Use Cases

### Users

- **{User group/persona}**: {role, need, pain point, relevant context}

### Key Use Cases

#### UC-{N}: {Title}

- **Actor**: {user/system}
- **Trigger**: {what starts the flow}
- **Main flow**: {ordered plain-language steps}
- **Success outcome**: {what is true after success}
- **Edge/error paths**: {important alternatives and failures}

## 4. Requirements and Acceptance

| ID | Requirement | Priority | Acceptance Criteria | Trace |
| --- | --- | --- | --- | --- |
| FR-001 | {system behavior} | Must / Should / Could | {verifiable criteria, Given/When/Then if useful} | {goal/use case} |

## 5. Quality, Security, and Dependencies

### Quality Requirements

- **Performance**: {latency, throughput, resource, or `N/A - reason`}
- **Reliability**: {uptime, RTO/RPO, failure mode, or `N/A - reason`}
- **Scalability**: {growth expectation and limits, or `N/A - reason`}
- **Observability**: {logs, metrics, alerts, tracing, or `N/A - reason`}

### Security and Compliance

- **Authentication and authorization**: {model, roles, permissions, or `N/A - reason`}
- **Data classification**: {public/internal/confidential/restricted and examples}
- **PII/sensitive data**: {handling, retention, access limits, or `N/A - reason`}
- **Encryption**: {in transit / at rest expectations}
- **Compliance**: {regulations, controls, audit needs, or `N/A - reason`}

### Dependencies and Integrations

| Dependency | Purpose | Owner | Impact if Unavailable | Fallback/Degradation |
| --- | --- | --- | --- | --- |
| {service/team/vendor} | {why needed} | {owner} | {impact} | {fallback} |

## 6. Architecture and Interfaces

### Architecture Overview

{High-level architecture, component responsibilities, and diagram reference if available. Use `N/A - reason` if not relevant.}

### Data and Interface Contracts

- **Data model / key entities**: {entities, ownership, lifecycle, or `N/A - reason`}
- **APIs / events / UI contracts**: {endpoints, schemas, events, UI states, or `N/A - reason`}
- **Error handling**: {expected error states and client/user behavior}
- **Ownership**: {team/person responsible for components or contracts}

## 7. Risks and Open Questions

### Risks

| Risk | Impact | Mitigation | Owner |
| --- | --- | --- | --- |
| {risk} | High / Medium / Low | {mitigation} | {owner} |

### Open Questions

| Question | Owner | Due Date | Notes |
| --- | --- | --- | --- |
| {question} | {owner} | {date/TBD} | {context} |

## 8. Delivery Plan

### MVP / First Release

{Smallest useful release and what must be true to ship it.}

### Milestones

| Milestone | Deliverables | Target | Dependencies |
| --- | --- | --- | --- |
| {milestone} | {deliverables} | {date/TBD} | {dependencies} |

### Rollout and Rollback

- **Rollout**: {release strategy, flags, migration, communication}
- **Rollback**: {how to recover if the release fails}

## Appendix

### Traceability Summary

| Goal | Use Cases | Requirements | Metrics |
| --- | --- | --- | --- |
| {G1} | {UCs} | {FRs} | {metrics} |

### Glossary

- **{Term}**: {definition}

### References

- {Related RFCs, ADRs, designs, tickets, dashboards, research}

### Change Log

| Version | Date | Author | Changes |
| --- | --- | --- | --- |
| {VERSION} | {DATE} | {AUTHOR} | Initial draft |
