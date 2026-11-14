import { HomeAccountBanner } from "@/components/home-account-banner";
import { HomeScreen } from "@/components/home-screen";

/** The paste field; the recents send the focus back to it when their last card goes. */
const CAPTURE_FIELD_ID = "capture-url";

/** « Accueil » (refonte Boudoir, spec R3); a guest also sees the account banner (comptes visibles 2026-11-14). */
export default function Home() {
  return (
    <>
      <HomeAccountBanner />
      <HomeScreen fieldId={CAPTURE_FIELD_ID} />
    </>
  );
}
