# Security

## A problem in plugvet itself

For example, a plugin crafted to crash plugvet, hide a component from its report, or make it run something. Report it privately: the repository's **Security** tab → **Report a vulnerability**. Please do not open a public issue. You will get a reply within a week.

## A malicious plugin you found with plugvet

Do not publish it, and do not turn the live plugin into a fixture.

1. Report it privately to the plugin's author and to the marketplace that lists it. For Anthropic's official and community marketplaces, report it to Anthropic as well.
2. Give them up to 30 days before saying anything in public.
3. If you want a rule for the technique, write it with an inert, rewritten fixture: same technique, no working payload, `.invalid` domains.

## What plugvet does not do

plugvet reads files. It does not run the plugin, open network connections, or follow symbolic links. A clean report means none of the rules matched and every component is listed for you to read; it does not mean the plugin is safe.
