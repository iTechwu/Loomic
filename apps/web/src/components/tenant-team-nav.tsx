"use client";

import { Building2, ChevronsUpDown, UserRound, UsersRound } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";

export function TenantTeamNav() {
  const { session } = useAuth();
  const context = session?.tenant_context;
  if (!context) {
    // SSO can legitimately omit tenant context during an upstream outage or
    // for personal accounts. Never infer a team from local product data.
    return (
      <output
        className="fixed right-3 top-3 z-40 flex h-11 max-w-[calc(100vw-5.5rem)] items-center gap-2 border border-border bg-background px-2.5 text-left text-xs shadow-sm md:right-5 md:top-4"
        aria-describedby="personal-workspace-context"
        title="SSO 未提供租户与团队信息，当前仅显示个人工作区。"
      >
        <UserRound
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="truncate font-medium">个人工作区</span>
        <span id="personal-workspace-context" className="sr-only">
          SSO 未提供租户与团队信息，当前仅显示个人工作区。
        </span>
      </output>
    );
  }

  const primaryTeam = context.teams[0];
  return (
    <div className="fixed right-3 top-3 z-40 md:right-5 md:top-4">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="查看当前租户和团队"
          className="flex h-11 max-w-[calc(100vw-5.5rem)] items-center gap-2 border border-border bg-background px-2.5 text-left shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-xs font-medium">
              {context.tenant.name}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {primaryTeam?.name ?? "未加入团队"}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{context.tenant.name}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup aria-label="团队列表">
            {context.teams.length ? (
              context.teams.map((team) => (
                <DropdownMenuItem
                  disabled
                  key={team.id}
                  className="cursor-default"
                >
                  <UsersRound className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{team.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {team.role}
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled className="cursor-default">
                未加入团队
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
