import Link from "next/link";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <p className="site-header__brand">
            <span className="site-header__mark" aria-hidden="true">
              BYS
            </span>
            {APP_NAME}
          </p>
        </Link>
        <p className="site-header__tagline">{APP_TAGLINE}</p>
      </div>
    </header>
  );
}
