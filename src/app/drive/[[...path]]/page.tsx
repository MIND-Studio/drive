import DriveBrowser from "@/components/DriveBrowser";

export default async function DrivePage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const segments = path ?? [];
  return <DriveBrowser pathSegments={segments} />;
}
