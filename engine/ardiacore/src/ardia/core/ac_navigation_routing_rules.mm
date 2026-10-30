#include "ardia/core/ac_navigation_routing.h"

#import <Foundation/Foundation.h>

#include <utility>

#include "base/no_destructor.h"
#include "base/strings/string_util.h"
#include "base/strings/sys_string_conversions.h"

namespace ardiacore {

namespace {

constexpr std::string_view kHttp = "http://";
constexpr std::string_view kHttps = "https://";
constexpr std::string_view kFile = "file:";

bool StartsWithASCII(std::string_view text, std::string_view prefix) {
  return base::StartsWith(text, prefix, base::CompareCase::INSENSITIVE_ASCII);
}

bool IsWebURL(std::string_view url) {
  return StartsWithASCII(url, kHttp) || StartsWithASCII(url, kHttps);
}

std::string EqualsForm(std::string_view text) {
  std::string form = base::ToLowerASCII(text);
  for (std::string_view scheme : {kHttp, kHttps}) {
    if (form.starts_with(scheme)) {
      form.erase(0, scheme.size());
      break;
    }
  }
  if (const size_t cut = form.find_first_of("?#"); cut != std::string::npos) {
    form.resize(cut);
  }
  if (!form.empty() && form.back() == '/') {
    form.pop_back();
  }
  return form;
}

std::string Text(id value) {
  return [value isKindOfClass:NSString.class] ? base::SysNSStringToUTF8(value) : std::string();
}

std::optional<LinkDestination> DestinationFrom(id value) {
  if (![value isKindOfClass:NSDictionary.class]) {
    return std::nullopt;
  }
  const std::string kind = Text(value[@"kind"]);
  LinkDestination destination;
  if (kind == "little") {
    destination.kind = LinkDestination::Kind::kLittle;
  } else if (kind == "recent") {
    destination.kind = LinkDestination::Kind::kRecent;
  } else if (kind == "profile") {
    destination.kind = LinkDestination::Kind::kSidebar;
    destination.sidebar = Text(value[@"profileId"]);
    if (destination.sidebar.empty()) {
      return std::nullopt;
    }
  } else {
    return std::nullopt;
  }
  return destination;
}

LinkRouting RoutingFrom(NSDictionary* config) {
  LinkRouting routing;
  NSDictionary* profiles = [config[@"profiles"] isKindOfClass:NSDictionary.class] ? config[@"profiles"] : @{};
  for (id sidebar in profiles) {
    if ([sidebar isKindOfClass:NSString.class] && [profiles[sidebar] isKindOfClass:NSString.class]) {
      routing.engines[base::SysNSStringToUTF8(sidebar)] = base::SysNSStringToUTF8(profiles[sidebar]);
    }
  }
  routing.recent = Text(config[@"recent"]);
  NSArray* rules = [config[@"rules"] isKindOfClass:NSArray.class] ? config[@"rules"] : @[];
  for (id value in rules) {
    if (![value isKindOfClass:NSDictionary.class]) {
      continue;
    }
    const std::string match = Text(value[@"match"]);
    if (match != "contains" && match != "equals") {
      continue;
    }
    const std::string text = Text(value[@"text"]);
    std::optional<LinkDestination> destination = DestinationFrom(value[@"destination"]);
    if (base::TrimWhitespaceASCII(text, base::TRIM_ALL).empty() || !destination ||
        (destination->kind == LinkDestination::Kind::kSidebar && !routing.engines.contains(destination->sidebar))) {
      continue;
    }
    LinkRule rule;
    rule.equals = match == "equals";
    rule.text = rule.equals ? EqualsForm(text) : base::ToLowerASCII(text);
    if (rule.text.empty()) {
      continue;
    }
    rule.destination = std::move(*destination);
    routing.rules.push_back(std::move(rule));
  }
  std::optional<LinkDestination> fallback = DestinationFrom(config[@"defaultDestination"]);
  routing.default_destination = fallback.value_or(LinkDestination());
  if (routing.default_destination.kind == LinkDestination::Kind::kSidebar &&
      !routing.engines.contains(routing.default_destination.sidebar)) {
    routing.default_destination = {LinkDestination::Kind::kRecent, std::string()};
  }
  return routing;
}

std::shared_ptr<const LinkRouting>& Installed() {
  static base::NoDestructor<std::shared_ptr<const LinkRouting>> routing(std::make_shared<LinkRouting>());
  return *routing;
}

bool g_live_routing = false;

const LinkRule* MatchLinkRule(const LinkRouting& routing, std::string_view url) {
  const std::string lower = base::ToLowerASCII(url);
  const std::string equals = EqualsForm(url);
  for (const LinkRule& rule : routing.rules) {
    if (rule.equals ? equals == rule.text : lower.find(rule.text) != std::string::npos) {
      return &rule;
    }
  }
  return nullptr;
}

}

const std::string* EngineOf(const LinkRouting& routing, const std::string& sidebar) {
  auto it = routing.engines.find(sidebar);
  return it == routing.engines.end() ? nullptr : &it->second;
}

std::optional<LinkDecision> DecideLink(const LinkRouting& routing,
                                       std::string_view url,
                                       LinkOrigin origin,
                                       const std::string& source_sidebar) {
  const bool web = IsWebURL(url);
  const bool external = origin == LinkOrigin::kExternal;
  if (!external && (!web || source_sidebar.empty())) {
    return LinkDecision();
  }
  const LinkRule* rule = web ? MatchLinkRule(routing, url) : nullptr;
  if (!rule && !external) {
    return LinkDecision();
  }
  LinkDestination destination = rule ? rule->destination : routing.default_destination;
  if (!web && destination.kind == LinkDestination::Kind::kLittle && !StartsWithASCII(url, kFile)) {
    destination = {LinkDestination::Kind::kRecent, std::string()};
  }
  LinkDecision decision;
  switch (destination.kind) {
    case LinkDestination::Kind::kLittle:
      decision.action = LinkAction::kLittle;
      decision.sidebar = external ? routing.recent : source_sidebar;
      break;
    case LinkDestination::Kind::kRecent:
      decision.action = LinkAction::kTab;
      decision.sidebar = routing.recent;
      break;
    case LinkDestination::Kind::kSidebar:
      decision.action = LinkAction::kTab;
      decision.sidebar = destination.sidebar;
      break;
  }
  const std::string* engine = EngineOf(routing, decision.sidebar);
  if (!engine) {
    return std::nullopt;
  }
  decision.engine = *engine;
  if (!external && decision.action == LinkAction::kTab && decision.sidebar == source_sidebar) {
    decision.action = LinkAction::kSame;
  }
  return decision;
}

void InstallLinkRouting(NSDictionary* config, bool live) {
  if (!live && g_live_routing) {
    return;
  }
  g_live_routing = g_live_routing || live;
  Installed() = std::make_shared<const LinkRouting>(
      RoutingFrom([config isKindOfClass:NSDictionary.class] ? config : @{}));
}

std::shared_ptr<const LinkRouting> InstalledLinkRouting() {
  return Installed();
}

NSDictionary* LinkDecisionDictionary(const LinkDecision& decision) {
  switch (decision.action) {
    case LinkAction::kNoMatch:
      return @{@"action" : @"none"};
    case LinkAction::kSame:
    case LinkAction::kTab:
    case LinkAction::kLittle:
      break;
  }
  NSString* action = decision.action == LinkAction::kSame ? @"same"
                     : decision.action == LinkAction::kTab ? @"tab"
                                                           : @"little";
  return @{
    @"action" : action,
    @"profileId" : base::SysUTF8ToNSString(decision.sidebar),
    @"engine" : base::SysUTF8ToNSString(decision.engine),
  };
}
}
