export interface FooterGithubProfile {
  username: string;
  name: string;
}

/** Self-hosters can set their public profile here. No managed-site identity ships. */
export const FOOTER_GITHUB_PROFILE: FooterGithubProfile | null = null;
