import type { Metadata } from "next";
import Link from "next/link";
import { Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { homeForRole } from "@/lib/auth/roles";
import { getAuthSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Unauthorized",
};

export const instant = false;

export default async function UnauthorizedPage() {
  const session = await getAuthSession();
  const home =
    session.status === "ready" ? homeForRole(session.profile.role) : "/login";
  const label =
    session.status === "ready" ? "Go to your workspace" : "Sign in";

  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="bg-destructive/10 text-destructive mb-2 flex size-10 items-center justify-center rounded-lg">
            <Shield className="size-5" />
          </div>
          <CardTitle>Unauthorized</CardTitle>
          <CardDescription>
            This area is limited to a different role. Your account stays on
            the workspace it is allowed to open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            nativeButton={false}
            render={<Link href={home} />}
            size="lg"
          >
            {label}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
