"use client";

import { useMemo, type ComponentProps } from "react";
import { Button } from "@agent-hub/ui";
import { useI18n } from "fumadocs-ui/contexts/i18n";
import type { DefaultSearchDialogProps } from "fumadocs-ui/components/dialog/search-default";
import {
  SearchDialog,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search";
import { useDocsSearch } from "fumadocs-core/search/client";
import { fetchClient } from "fumadocs-core/search/client/fetch";

/** Preserve the docs search engine and keyboard navigation inside Ciele's tray. */
export function DocsSearchDialog({
  open,
  onOpenChange,
  links = [],
  api,
  delayMs,
  footer,
}: DefaultSearchDialogProps) {
  const { locale } = useI18n();
  const { search, setSearch, query } = useDocsSearch({
    client: fetchClient({ api, locale }),
    delayMs,
  });
  const defaults = useMemo<ComponentProps<typeof SearchDialogList>["items"]>(
    () =>
      links.length
        ? links.map(([content, url]) => ({
            type: "page",
            id: content,
            content,
            url,
          }))
        : null,
    [links],
  );

  return (
    <SearchDialog
      open={open}
      onOpenChange={onOpenChange}
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
    >
      <SearchDialogOverlay className="ui-modal-overlay ui-modal-instant" />
      <SearchDialogContent
        className="ui-modal ui-modal-search"
        data-modal-motion="instant"
      >
        <SearchDialogHeader className="ui-modal-header">
          <SearchDialogIcon />
          <SearchDialogInput />
          <Button
            variant="secondary"
            size="sm"
            aria-label="Close search"
            onClick={() => onOpenChange(false)}
          >
            Esc
          </Button>
        </SearchDialogHeader>
        <div className="ui-modal-body" data-modal-padding="none">
          <SearchDialogList
            items={query.data !== "empty" ? query.data : defaults}
          />
        </div>
        {footer && (
          <SearchDialogFooter className="ui-modal-footer">
            {footer}
          </SearchDialogFooter>
        )}
      </SearchDialogContent>
    </SearchDialog>
  );
}
