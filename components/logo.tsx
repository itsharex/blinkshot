export default function Logo() {
  return (
    <div className="flex h-[24px] min-w-[228px] flex-row gap-2.5">
      <a target="_blank" href="/">
        <img src="/blinkshot.svg" className="h-[24px] min-w-[100px]" />
      </a>
      <svg
        width="2"
        height="20"
        viewBox="0 0 2 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M1 0V19.5" stroke="#F3F3F3" strokeWidth="0.5" />
      </svg>
      <a
        href="https://togetherai.link/?utm_source=blinkshot&utm_medium=referral&utm_campaign=example-app"
        target="_blank"
      >
        <img src="/together.ai.png" className="h-[23.3px] min-w-[103px]" />
      </a>
    </div>
  );
}
