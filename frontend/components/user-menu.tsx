"use client";

import { usePlexusSession } from "@/hooks/use-plexus-session";
import { useRouter } from "next/navigation";
import { LogOut, Settings, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { isSignedIn, name, email, imageUrl, signOut } = usePlexusSession();
  const router = useRouter();

  if (!isSignedIn) return null;

  const initials =
    (name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") ||
    email?.[0]?.toUpperCase() ||
    "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full w-6 h-6 overflow-hidden ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote user avatar URL (Clerk) not in next.config images domains
            <img
              src={imageUrl}
              alt={name || "User"}
              className="w-6 h-6 rounded-full object-cover"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
              {initials}
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            {name && (
              <p className="text-sm font-medium leading-none">{name}</p>
            )}
            <p className="text-xs leading-none text-muted-foreground">
              {email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push("/profile")}
          className="text-xs"
        >
          <User className="mr-2 h-3.5 w-3.5" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => router.push("/settings")}
          className="text-xs"
        >
          <Settings className="mr-2 h-3.5 w-3.5" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut()} className="text-xs">
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
