import Head from "next/head";
import { AuthForm } from "@/components/auth/AuthForm";
import { Aidir3Gate } from "@/components/auth/Aidir3Gate";
import { tr } from "@/lib/i18n";
import { VIEWPORT } from "@/lib/viewport";

export default function LoginPage() {
  return (
    <>
      <Head>
        <meta key="viewport" name="viewport" content={VIEWPORT} />
        <title>{tr("page.sign_in_hycanvas")}</title>
      </Head>
      {/* aidir3 fork: sign-in happens on the aidir3 login page when configured. */}
      <Aidir3Gate>
        <AuthForm mode="login" />
      </Aidir3Gate>
    </>
  );
}
