import Head from "next/head";
import { AuthForm } from "@/components/auth/AuthForm";
import { Aidir3Gate } from "@/components/auth/Aidir3Gate";
import { tr } from "@/lib/i18n";
import { VIEWPORT } from "@/lib/viewport";

export default function SignupPage() {
  return (
    <>
      <Head>
        <meta key="viewport" name="viewport" content={VIEWPORT} />
        <title>{tr("page.create_account_hycanvas")}</title>
      </Head>
      {/* aidir3 fork: accounts are created on aidir3.com when configured. */}
      <Aidir3Gate>
        <AuthForm mode="signup" />
      </Aidir3Gate>
    </>
  );
}
