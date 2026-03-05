interface ActivityBadgeProps {
  commentCount: number;
  reviewCount: number;
}

function ActivityBadge(props: ActivityBadgeProps) {
  const total = () => props.commentCount + props.reviewCount;

  return (
    <>
      {total() > 0 && (
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-900 text-indigo-300">
          {props.commentCount > 0 && <span>{props.commentCount} 💬</span>}
          {props.reviewCount > 0 && <span>{props.reviewCount} 📝</span>}
        </span>
      )}
    </>
  );
}

export default ActivityBadge;
