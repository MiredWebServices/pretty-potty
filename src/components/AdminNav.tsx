import { Link, useLocation } from "react-router-dom";
import { Inbox, FileText, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AdminNavProps {
  email?: string | null;
  onSignOut?: () => void;
}

const tabs = [
  { to: "/admin/inbox", label: "Inbox", icon: Inbox, match: "/admin/inbox" },
  { to: "/admin/invoices", label: "Invoices", icon: FileText, match: "/admin/invoices" },
];

const AdminNav = ({ email, onSignOut }: AdminNavProps) => {
  const { pathname } = useLocation();
  return (
    <nav className="flex items-center gap-2 flex-wrap">
      <div className="flex rounded-md border overflow-hidden">
        {tabs.map(({ to, label, icon: Icon, match }) => {
          const active = pathname === match || pathname.startsWith(match + "/");
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              } ${match === "/admin/invoices" ? "border-l" : ""}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </div>
      {email && (
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {email}
        </span>
      )}
      {onSignOut && (
        <Button variant="ghost" size="sm" onClick={onSignOut}>
          <LogOut className="h-4 w-4 mr-1" />
          Sign out
        </Button>
      )}
    </nav>
  );
};

export default AdminNav;
