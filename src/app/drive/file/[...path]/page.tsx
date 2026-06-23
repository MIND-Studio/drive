import FilePreview from "@/components/FilePreview";

export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ src?: string }>;
}) {
  const { path } = await params;
  const { src } = await searchParams;
  return <FilePreview pathSegments={path} srcUrl={src} />;
}
