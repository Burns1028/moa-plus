import * as React from "react";

const colors = [
  "#639fe8",
  "#76cdb0",
  "#b39aeb",
  "#e6ae6d",
  "#e597b8",
  "#70c4d5",
  "#c1c66e",
  "#e79585",
];

/** A worker's visual identity depends only on its immutable native Session ID. */
export const WorkerIcon = React.memo(function WorkerIcon({
  workerId,
}: {
  workerId: string;
}) {
  let hash = 2166136261;
  for (let i = 0; i < workerId.length; i++)
    hash = Math.imul(hash ^ workerId.charCodeAt(i), 16777619) >>> 0;
  const shape = hash % 8;
  let motif: React.ReactNode;
  switch (shape) {
    case 0:
      motif = (
        <>
          {[0, 90, 180, 270].map((a) => (
            <circle
              key={a}
              cx="12"
              cy="6.8"
              r="5"
              transform={`rotate(${a} 12 12)`}
              opacity=".7"
            />
          ))}
          <circle cx="12" cy="12" r="3.1" opacity=".95" />
        </>
      );
      break;
    case 1:
      motif = (
        <>
          <g fill="none" stroke="currentColor" strokeWidth="1.25">
            <circle cx="12" cy="12" r="10" />
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <ellipse
                key={a}
                cx="12"
                cy="8"
                rx="3.5"
                ry="5.5"
                transform={`rotate(${a} 12 12)`}
              />
            ))}
          </g>
          <circle cx="12" cy="12" r="3.3" opacity=".7" />
        </>
      );
      break;
    case 2:
      motif = (
        <>
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse
              key={a}
              cx="12"
              cy="7.1"
              rx="3.8"
              ry="5.8"
              transform={`rotate(${a} 12 12)`}
              opacity=".72"
            />
          ))}
          <circle
            cx="12"
            cy="12"
            r="2.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </>
      );
      break;
    case 3:
      motif = (
        <>
          {[0, 60, 120].map((a) => (
            <ellipse
              key={a}
              cx="12"
              cy="12"
              rx="10"
              ry="4.6"
              transform={`rotate(${a} 12 12)`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          ))}
          <circle cx="12" cy="12" r="3.2" />
        </>
      );
      break;
    case 4:
      motif = (
        <>
          {[0, 90, 180, 270].map((a) => (
            <path
              key={a}
              d="M12 1.5 17 7 12 12.5 7 7Z"
              transform={`rotate(${a} 12 12)`}
              opacity=".75"
            />
          ))}
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
      break;
    case 5:
      motif = (
        <>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path
              key={a}
              d="M12 1.5 14.8 7.7 12 10 9.2 7.7Z"
              transform={`rotate(${a} 12 12)`}
              opacity=".8"
            />
          ))}
          <circle
            cx="12"
            cy="12"
            r="4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </>
      );
      break;
    case 6:
      motif = (
        <>
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <circle
              key={a}
              cx="12"
              cy="5"
              r="3.4"
              transform={`rotate(${a} 12 12)`}
              opacity=".75"
            />
          ))}
          <circle cx="12" cy="12" r="3.4" />
        </>
      );
      break;
    default:
      motif = (
        <>
          {[0, 120, 240].map((a) => (
            <path
              key={a}
              d="M12 12C1 13 2 3 9 2c5-.7 8 4 3 10Z"
              transform={`rotate(${a} 12 12)`}
              opacity=".78"
            />
          ))}
          <circle cx="12" cy="12" r="2.4" />
        </>
      );
  }
  return (
    <svg
      className="pm-worker-icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="currentColor"
      style={{ color: colors[(hash >>> 8) % colors.length] }}
      aria-hidden="true"
      focusable="false"
    >
      {motif}
    </svg>
  );
});
