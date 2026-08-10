export default function LoadingState({ label = 'Loading control-plane state…' }: { label?: string }) { return <div className="empty-state"><span className="loader" /><p>{label}</p></div>; }
