# Enhanced workload migration playbooks

Porterline now presents a separate, gate-driven playbook for OneDrive, SharePoint, Exchange, and Teams in the New Migration Job wizard. The playbooks deliberately do not treat every workload as the same copy operation.

## Shared control model

Every workload follows six control phases: inventory, target preparation, identity and dependency readiness, pilot, execution/cutover, and validation/closeout. A phase exposes a gate and concrete checks. Operators can move between phases in the wizard, but the migration service should only release the next operational phase after the current gate is passed.

Microsoft's current tenant-to-tenant planning guidance identifies identity mapping, licensing, coexistence, and workload dependencies as cross-workload concerns. It specifically calls out that Teams content depends on Exchange mailboxes and that OneDrive and SharePoint share permission considerations. [1]

## OneDrive

The OneDrive playbook covers source drive inventory, inactive and held accounts, target provisioning, identity mapping, path and sharing remediation, representative pilots, full copy and delta behavior, final freeze, link and permission validation, and rollback hold. The exact execution path must match the selected migration method because native cross-tenant OneDrive moves may not support incremental passes. [2]

## SharePoint

The SharePoint playbook covers site topology, hubs, groups, libraries, lists, pages, web parts, workflows, apps, Power Platform, sensitivity labels, path limits, site size and item limits, identity mapping, Team-connected boundaries, pilot site types, automation smoke tests, and owner acceptance. Native cross-tenant SharePoint moves have important constraints, including no overwrite or merge of an existing target site and no delta passes for the one-time move model. [3]

## Exchange

The Exchange playbook covers mailbox and archive inventory, holds, delegates, shared and resource mailboxes, target licensing, migration application and endpoint setup, organization relationships, scoped mail-enabled security groups, mail flow, prevalidation, synchronization, cutover, client reconfiguration, compliance, and retry handling. Microsoft requires validation before a batch can migrate and supports revalidation after per-user failures are corrected. [4]

## Teams

The Teams playbook treats Teams as a dependency graph rather than a single container. It covers team and channel inventory, guest and owner mapping, Exchange and SharePoint dependencies, federation, apps and bots, standard/private/shared channel pilots, supported conversations and meetings, associated SharePoint files, user communications, duplicates and out-of-scope content, and owner sign-off. Microsoft Migration Orchestrator supports Exchange, OneDrive, Teams chats, and Teams meetings as user workloads, while shared Teams channels and SharePoint sites remain separate scope that requires its own plan. [5]

## Operator expectations

- Use the playbook checks as readiness evidence, not as a cosmetic checklist.
- Record exclusions and unsupported content explicitly in the remediation queue.
- Keep source access or redirects available until validation and the rollback window are complete.
- Use per-user or per-site results for remediation instead of rerunning an entire successful batch.
- Keep the workload scope in the job record so reports distinguish a OneDrive move, a SharePoint site move, an Exchange mailbox move, and a Teams migration.

## References

[1]: https://learn.microsoft.com/en-us/microsoft-365/migration/microsoft-365-tenant-to-tenant-migrations?view=o365-worldwide "Microsoft plan a tenant-to-tenant migration"
[2]: https://learn.microsoft.com/en-us/microsoft-365/migration/migration-orchestrator-1-overview?view=o365-worldwide "Microsoft Migration Orchestrator overview"
[3]: https://learn.microsoft.com/en-us/microsoft-365/migration/cross-tenant-sharepoint-migration?view=o365-worldwide "Microsoft cross-tenant SharePoint migration"
[4]: https://learn.microsoft.com/en-us/microsoft-365/migration/cross-tenant-mailbox-migration?view=o365-worldwide "Microsoft cross-tenant mailbox migration"
[5]: https://sharegate.com/blog/2-ways-migrate-microsoft-teams-from-one-tenant-to-another "ShareGate ways to migrate Teams between tenants"
