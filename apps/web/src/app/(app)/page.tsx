import { HomeScreen } from "@/components/home-screen";

/** The paste field; the recents send the focus back to it when their last card goes. */
const CAPTURE_FIELD_ID = "capture-url";

/** « Accueil » (refonte Boudoir, spec R3). */
export default function Home() {
  return <HomeScreen fieldId={CAPTURE_FIELD_ID} />;
}
