import Workspace from '../../../components/Workspace';
export default async function IdeaPage({ params }) {
  const { id } = await params;
  return <Workspace initialIdeaId={id} />;
}
