import { AwbPreview } from "@/components/merchant/awb-preview";

export default function LabelCheckPage() {
  return (
    <main data-label-check="phase-95" className="flex flex-col gap-16 bg-zinc-100 px-6 py-8">
      <AwbPreview format="a6" language="ar" merchantName="Gadoura Store" />
      <AwbPreview format="a4" layout="one" language="ar" merchantName="Gadoura Store" />
    </main>
  );
}
