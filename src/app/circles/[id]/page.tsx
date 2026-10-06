import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CircleDetailClient from "./circle-detail-client";
import { SectionErrorBoundary } from "@/components/error/section-error-boundary";
import { getCircle } from "@/app/actions/circle-detail";
import { circlesSiteUrl } from "@/lib/circle-create";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CircleDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string | string[] }>;
}

// Access depends on the viewer's session and membership — never cache or
// prerender a circle page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Circle",
  description: "The community that keeps the fire alive between events.",
};

/**
 * /circles/[id] — the access gate runs here, on the server, before anything
 * renders: `getCircle` resolves the viewer's membership and the circle-type
 * rules (`@/lib/circle-access`). A secret circle (to anyone but its members
 * and invitees), an inactive circle and a missing one all 404 the same way.
 * A private circle renders its preview to non-members. Every action the
 * client calls afterwards re-checks the same rules.
 */
export default async function CircleDetailPage({
  params,
  searchParams,
}: CircleDetailPageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const circle = await getCircle(id);
  if (!circle) notFound();
  // After the create form (`?created=1`): tell the owner where it shows.
  const { created } = await searchParams;
  const createdNotice =
    created === "1" && circle.viewer.isOwner
      ? {
          siteUrl: circle.slug
            ? circlesSiteUrl(circle.slug, circle.circle_type)
            : null,
        }
      : null;
  return (
    <SectionErrorBoundary section="Circle">
      <CircleDetailClient
        circleId={id}
        initialCircle={circle}
        createdNotice={createdNotice}
      />
    </SectionErrorBoundary>
  );
}
