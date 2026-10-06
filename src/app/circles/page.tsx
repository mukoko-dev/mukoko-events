import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import CirclesIndexClient from "./circles-index-client";
import { CreateCircleForm } from "./create-circle-form";
import { SectionErrorBoundary } from "@/components/error/section-error-boundary";
import { isDevBypass } from "@/lib/auth/dev";
import { isNyuchiApiConfigured } from "@/lib/nyuchi-api/client";
import { listCategories } from "@/lib/mongo/lookups";

export const metadata: Metadata = {
  title: "Circles — your communities",
  description: "The communities that keep the fire alive between events.",
};

/** Where circles.mukoko.com's "Create a circle" button lands. */
const CREATE_PATH = "/circles?create=1";

interface CirclesIndexPageProps {
  searchParams: Promise<{ create?: string | string[] }>;
}

/**
 * /circles — your circles, and `?create=1` the create-circle form
 * (mukoko-dev/mukoko-events#159). Creating needs a session: a signed-out
 * visitor signs in first and comes back to the form.
 */
export default async function CirclesIndexPage({
  searchParams,
}: CirclesIndexPageProps) {
  const { create } = await searchParams;
  if (create === "1") {
    const signedIn = isDevBypass() || Boolean((await withAuth()).user);
    if (!signedIn) {
      redirect(`/auth/hosted?return_to=${encodeURIComponent(CREATE_PATH)}`);
    }
    const categories = await listCategories().catch(() => []);
    return (
      <div className="max-w-200 mx-auto px-6 py-10">
        <SectionErrorBoundary section="Create a circle">
          <CreateCircleForm
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            available={isNyuchiApiConfigured()}
          />
        </SectionErrorBoundary>
      </div>
    );
  }
  return (
    <SectionErrorBoundary section="Your circles">
      <CirclesIndexClient />
    </SectionErrorBoundary>
  );
}
