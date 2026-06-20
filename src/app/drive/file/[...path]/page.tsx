import FilePreview from "@/components/FilePreview";

export default async function FilePage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return <FilePreview pathSegments={path} />;
}
