'use strict';

const https = require('https');
const http = require('http');
const { ComponentType, ButtonStyle, MessageFlags, MessageType, Collection } = require('discord.js');

// AI assistance was used for parts of this transcript renderer; the output has
// been manually reviewed.

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtTime(date) {
    return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });
}

function fmtDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
}

function sameGroup(prev, cur) {
    if (!prev || prev.author.id !== cur.author.id) return false;
    if (cur.system || prev.system) return false;
    if (cur.type === MessageType.Reply) return false;
    return (cur.createdTimestamp - prev.createdTimestamp) < 7 * 60 * 1000;
}

const USERNAME_COLORS = [
    '#f23f43', '#f0b232', '#23a55a', '#00a8fc',
    '#5865f2', '#eb459e', '#57f287', '#ed4245', '#9b59b6',
];
function usernameColor(userId) {
    const hash = [...String(userId)].reduce((a, c) => a + c.charCodeAt(0), 0);
    return USERNAME_COLORS[hash % USERNAME_COLORS.length];
}


function renderContent(raw, msg = null) {
    if (!raw) return '';

    let s = esc(String(raw).split('\u0000').join(''));

    const protected_ = [];
    const protect = (html) => { const i = protected_.length; protected_.push(html); return `\x00P${i}\x00`; };

    // Fenced code blocks
    s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
        protect(`<pre class="code-block">${lang ? `<div class="code-lang">${esc(lang)}</div>` : ''}<code>${code}</code></pre>`)
    );
    // Inline code
    s = s.replace(/`([^`\n]+)`/g, (_, code) =>
        protect(`<code class="inline-code">${code}</code>`)
    );

    // Custom emoji  <:name:id>  <a:name:id>
    s = s.replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, anim, name, id) => {
        const ext = anim ? 'gif' : 'webp';
        return `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48" alt=":${esc(name)}:" title=":${esc(name)}:">`;
    });

    // Timestamp tags  <t:unix:format>
    s = s.replace(/&lt;t:(\d+)(?::[tTdDfFR])?&gt;/g, (_, ts) =>
        `<span class="timestamp">${esc(fmtTime(new Date(+ts * 1000)))}</span>`
    );

    // User mentions  <@id>  <@!id>
    s = s.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
        const u = msg?.mentions?.users?.get(id);
        return `<span class="mention">@${u ? esc(u.username) : id}</span>`;
    });
    // Role mentions  <@&id>
    s = s.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
        const r = msg?.mentions?.roles?.get(id);
        const rawColor = r?.hexColor;
        // Validate hex color — reject anything that isn't #RRGGBB to prevent CSS injection
        const color = rawColor && /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#c9cdfb';
        return `<span class="mention" style="color:${color};background-color:${color}26">@${r ? esc(r.name) : id}</span>`;
    });
    // Channel mentions  <#id>
    s = s.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
        const c = msg?.mentions?.channels?.get(id);
        return `<span class="mention">#${c ? esc(c.name) : id}</span>`;
    });
    // @everyone / @here
    s = s.replace(/@(everyone|here)/g, `<span class="mention">@$1</span>`);

    // Subtext  -#
    s = s.replace(/^-# (.+)$/gm, '<span class="subtext">$1</span>');

    // Headings
    s = s.replace(/^### (.+)$/gm, '<h3 class="md-h">$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2 class="md-h">$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1 class="md-h">$1</h1>');

    // Bold+italic first, then bold, then italic (order matters)
    s = s.replace(/\*\*\*(.+?)\*\*\*/gs, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/gs, '<em>$1</em>');
    s = s.replace(/__(.+?)__/gs, '<u>$1</u>');
    s = s.replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/gs, '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/gs, '<s>$1</s>');

    // Spoilers
    s = s.replace(/\|\|(.+?)\|\|/gs, `<span class="spoiler" onclick="this.classList.toggle('open')">$1</span>`);

    // Blockquotes (must come before newline conversion)
    s = s.replace(/^(&gt; .+(\n&gt; .+)*)/gm, (block) => {
        const inner = block.replace(/^&gt; /gm, '');
        return `<div class="blockquote">${inner}</div>`;
    });

    // Masked links  [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, url) =>
        `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    );

    // Plain URLs (don't double-link what's already in an <a>)
    s = s.replace(/(?<![="'(])(https?:\/\/[^\s<>")\]]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // Newlines → <br>
    s = s.replace(/\n/g, '<br>');

    // Restore protected blocks
    // eslint-disable-next-line no-control-regex
    s = s.replace(/\x00P(\d+)\x00/g, (_, i) => protected_[+i]);

    return s;
}


const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i;

function renderAttachments(attachments) {
    if (!attachments?.size) return '';
    return [...attachments.values()].map(att => {
        if (IMAGE_EXT.test(att.url)) {
            return `<div class="attachment"><a href="${esc(att.url)}" target="_blank" rel="noopener noreferrer"><img class="att-img" src="${esc(att.url)}" alt="${esc(att.name)}" loading="lazy"></a></div>`;
        }
        const kb = att.size ? ` — ${(att.size / 1024).toFixed(1)} KB` : '';
        return `<div class="attachment att-file"><a href="${esc(att.url)}" target="_blank" rel="noopener noreferrer" download><span class="att-file-icon">📎</span><span class="att-file-name">${esc(att.name)}</span><span class="att-file-size">${esc(kb)}</span></a></div>`;
    }).join('');
}

// ─── Embeds ──────────────────────────────────────────────────────────────────

function renderEmbed(embed) {
    const color = embed.color != null ? '#' + embed.color.toString(16).padStart(6, '0') : '#4f545c';

    let body = '';

    if (embed.author?.name) {
        const icon = embed.author.iconURL ? `<img class="embed-icon" src="${esc(embed.author.iconURL)}" alt="">` : '';
        const name = embed.author.url
            ? `<a href="${esc(embed.author.url)}" target="_blank" rel="noopener noreferrer">${esc(embed.author.name)}</a>`
            : esc(embed.author.name);
        body += `<div class="embed-author">${icon}<span>${name}</span></div>`;
    }

    if (embed.title) {
        const t = embed.url
            ? `<a href="${esc(embed.url)}" target="_blank" rel="noopener noreferrer">${esc(embed.title)}</a>`
            : esc(embed.title);
        body += `<div class="embed-title">${t}</div>`;
    }

    if (embed.description) {
        body += `<div class="embed-desc">${renderContent(embed.description)}</div>`;
    }

    if (embed.fields?.length) {
        body += '<div class="embed-fields">';
        for (const f of embed.fields) {
            body += `<div class="embed-field${f.inline ? ' inline' : ''}"><div class="ef-name">${esc(f.name)}</div><div class="ef-val">${renderContent(f.value)}</div></div>`;
        }
        body += '</div>';
    }

    if (embed.image?.url) {
        body += `<div class="embed-img"><a href="${esc(embed.image.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(embed.image.url)}" alt="" loading="lazy"></a></div>`;
    }

    const footerParts = [];
    if (embed.footer?.text) footerParts.push(esc(embed.footer.text));
    if (embed.timestamp) {
        footerParts.push(esc(new Date(embed.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })));
    }
    if (footerParts.length) {
        const icon = embed.footer?.iconURL ? `<img class="embed-icon" src="${esc(embed.footer.iconURL)}" alt="">` : '';
        body += `<div class="embed-footer">${icon}<span>${footerParts.join(' · ')}</span></div>`;
    }

    const thumb = embed.thumbnail?.url
        ? `<div class="embed-thumb"><img src="${esc(embed.thumbnail.url)}" alt="" loading="lazy"></div>`
        : '';

    return `<div class="embed" style="border-left-color:${esc(color)}"><div class="embed-inner"><div class="embed-body">${body}</div>${thumb}</div></div>`;
}

// ─── Reactions ────────────────────────────────────────────────────────────────

function renderReactions(reactions) {
    if (!reactions?.size) return '';
    const html = [...reactions.values()].map(r => {
        const e = r.emoji.id
            ? `<img class="rx-emoji" src="https://cdn.discordapp.com/emojis/${esc(r.emoji.id)}.${r.emoji.animated ? 'gif' : 'webp'}?size=20" alt="${esc(r.emoji.name)}">`
            : `<span class="rx-emoji">${esc(r.emoji.name)}</span>`;
        return `<div class="reaction">${e}<span class="rx-count">${r.count}</span></div>`;
    }).join('');
    return `<div class="reactions">${html}</div>`;
}

// ─── Reply reference ──────────────────────────────────────────────────────────

function renderReply(msg) {
    if (msg.type !== MessageType.Reply || !msg.reference?.messageId) return '';
    const ref = msg.channel?.messages?.cache?.get(msg.reference.messageId);
    if (!ref) {
        return `<div class="reply"><div class="reply-bar"><span class="reply-unknown">↩ Original message unavailable</span></div></div>`;
    }
    if (ref.system) {
        const icon = SYSTEM_ICONS[ref.type] || 'ℹ️';
        return `<div class="reply"><div class="reply-bar"><span class="reply-sys-icon">${icon}</span><span class="reply-unknown">↩ Reply to system message</span></div></div>`;
    }
    const snippet = ref.content
        ? renderContent(ref.content.length > 100 ? ref.content.slice(0, 100) + '…' : ref.content, ref)
        : (ref.attachments?.size ? '📎 Attachment' : (ref.embeds?.length ? '📋 Embed' : ''));
    const av = ref.author.displayAvatarURL({ size: 16, extension: 'webp' });
    const name = ref.member?.displayName || ref.author.username;
    const color = usernameColor(ref.author.id);
    return `<div class="reply"><div class="reply-bar"><img class="reply-av" src="${esc(av)}" alt=""><span class="reply-name" style="color:${esc(color)}">${esc(name)}</span><span class="reply-snippet">${snippet}</span></div></div>`;
}

// ─── Components (ActionRow + V2) ──────────────────────────────────────────────

function renderButton(btn) {
    const styleClass = {
        [ButtonStyle.Primary]:   'btn-primary',
        [ButtonStyle.Secondary]: 'btn-secondary',
        [ButtonStyle.Success]:   'btn-success',
        [ButtonStyle.Danger]:    'btn-danger',
        [ButtonStyle.Link]:      'btn-link',
    }[btn.style] || 'btn-secondary';

    const emoji = btn.emoji
        ? (btn.emoji.id
            ? `<img class="btn-emoji" src="https://cdn.discordapp.com/emojis/${esc(btn.emoji.id)}.${btn.emoji.animated ? 'gif' : 'webp'}?size=20" alt="">`
            : `<span>${esc(btn.emoji.name)}</span>`)
        : '';
    const extIcon = btn.style === ButtonStyle.Link
        ? `<svg class="ext-icon" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M15 2a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 11-2 0V4.41l-4.3 4.3a1 1 0 11-1.4-1.42L19.58 3H16a1 1 0 01-1-1zM5 2a3 3 0 00-3 3v14a3 3 0 003 3h14a3 3 0 003-3v-6a1 1 0 10-2 0v6a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1h6a1 1 0 100-2H5z"/></svg>`
        : '';
    return `<button class="discord-btn ${styleClass}" disabled>${emoji}${btn.label ? esc(btn.label) : ''}${extIcon}</button>`;
}

function renderSelectMenu(comp) {
    return `<div class="select-menu"><span>${esc(comp.placeholder || 'Select an option...')}</span><span class="sel-arrow">▾</span></div>`;
}

function renderComponentRow(comp, msg = null) {
    switch (comp.type) {
        case ComponentType.ActionRow:
            return `<div class="action-row">${comp.components.map(c => renderComponentItem(c)).join('')}</div>`;

        case ComponentType.Container: {
            const color = comp.accentColor != null
                ? '#' + comp.accentColor.toString(16).padStart(6, '0')
                : null;
            const style = color ? ` style="border-left-color:${esc(color)}"` : '';
            return `<div class="v2-container"${style}>${comp.components.map(c => renderComponentRow(c, msg)).join('')}</div>`;
        }

        case ComponentType.TextDisplay:
            return `<div class="v2-text">${renderContent(comp.content, msg)}</div>`;

        case ComponentType.Section:
            return `<div class="v2-section">${comp.components.map(c => renderComponentRow(c, msg)).join('')}${comp.accessory ? renderComponentItem(comp.accessory) : ''}</div>`;

        case ComponentType.MediaGallery:
            return `<div class="v2-gallery">${(comp.items || []).map(item =>
                `<a href="${esc(item.media?.url || '')}" target="_blank" rel="noopener noreferrer"><img src="${esc(item.media?.url || '')}" alt="${esc(item.description || '')}" loading="lazy"></a>`
            ).join('')}</div>`;

        case ComponentType.Separator:
            return `<hr class="v2-sep">`;

        case ComponentType.File: {
            const url = comp.file?.url || '';
            const name = url.split('/').pop()?.split('?')[0] || 'File';
            return `<div class="attachment att-file"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer" download><span class="att-file-icon">📎</span><span class="att-file-name">${esc(name)}</span></a></div>`;
        }

        default:
            return '';
    }
}

function renderComponentItem(comp) {
    switch (comp.type) {
        case ComponentType.Button: return renderButton(comp);
        case ComponentType.StringSelect:
        case ComponentType.UserSelect:
        case ComponentType.RoleSelect:
        case ComponentType.MentionableSelect:
        case ComponentType.ChannelSelect: return renderSelectMenu(comp);
        case ComponentType.Thumbnail:
            return comp.media?.url ? `<div class="section-thumbnail"><img src="${esc(comp.media.url)}" alt="" loading="lazy"></div>` : '';
        default: return '';
    }
}

// ─── System messages ──────────────────────────────────────────────────────────

const SYSTEM_ICONS = {
    [MessageType.GuildMemberJoin]: '👋',
    [MessageType.UserPremiumGuildSubscription]: '🚀',
    [MessageType.UserPremiumGuildSubscriptionTier1]: '🚀',
    [MessageType.UserPremiumGuildSubscriptionTier2]: '🚀',
    [MessageType.UserPremiumGuildSubscriptionTier3]: '🚀',
    [MessageType.ChannelPinnedMessage]: '📌',
    [MessageType.ThreadCreated]: '🧵',
    [MessageType.ChannelFollowAdd]: '📢',
    [MessageType.GuildInviteReminder]: '👋',
    [MessageType.AutoModerationAction]: '🛡️',
};

function systemMessageText(msg) {
    // All interpolations must be esc()-ed — display names can contain < > characters
    const name = esc(msg.member?.displayName || msg.author?.username || 'Someone');
    switch (msg.type) {
        case MessageType.GuildMemberJoin:
            return `${name} just joined the server.`;
        case MessageType.UserPremiumGuildSubscription:
            return `${name} just boosted the server!`;
        case MessageType.UserPremiumGuildSubscriptionTier1:
            return `${name} just boosted the server! The server has achieved Level 1!`;
        case MessageType.UserPremiumGuildSubscriptionTier2:
            return `${name} just boosted the server! The server has achieved Level 2!`;
        case MessageType.UserPremiumGuildSubscriptionTier3:
            return `${name} just boosted the server! The server has achieved Level 3!`;
        case MessageType.ChannelPinnedMessage:
            return `${name} pinned a message to this channel.`;
        case MessageType.ThreadCreated:
            return `${name} started a thread: ${esc(msg.content || 'Untitled')}`;
        case MessageType.ChannelFollowAdd:
            return `${name} has added ${esc(msg.content || 'a channel')} to this channel.`;
        case MessageType.GuildInviteReminder:
            return `Wondering who to invite? ${name} can help.`;
        case MessageType.AutoModerationAction:
            return `AutoMod flagged a message from ${name}.`;
        default:
            return esc(msg.content || '(system message)');
    }
}

function renderSystemMessage(msg) {
    const icon = SYSTEM_ICONS[msg.type] || 'ℹ️';
    return `<div class="msg msg-system" id="m-${esc(msg.id)}">
        <span class="sys-icon">${icon}</span>
        <span class="sys-text">${systemMessageText(msg)}</span>
        <span class="sys-ts">${esc(fmtTime(msg.createdAt))}</span>
    </div>`;
}


function renderMessage(msg, isFirst) {
    if (msg.system) return renderSystemMessage(msg);

    const isV2 = msg.flags?.has(MessageFlags.IsComponentsV2);
    const name = msg.member?.displayName || msg.author.username;
    const av = msg.author.displayAvatarURL({ size: 64, extension: 'webp' });
    const color = usernameColor(msg.author.id);
    const ts = fmtTime(msg.createdAt);
    const tsShort = msg.createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    let content = '';
    content += renderReply(msg);

    if (isV2) {
        content += msg.components.map(c => renderComponentRow(c, msg)).join('');
    } else {
        if (msg.content) content += `<div class="msg-content">${renderContent(msg.content, msg)}</div>`;
        content += renderAttachments(msg.attachments);
        if (msg.stickers?.size) {
            content += [...msg.stickers.values()].map(s =>
                `<img class="sticker" src="https://media.discordapp.net/stickers/${esc(s.id)}.${s.formatType === 3 ? 'json' : 'png'}?size=160" alt="${esc(s.name)}" title="${esc(s.name)}">`
            ).join('');
        }
        if (msg.embeds?.length) content += msg.embeds.map(renderEmbed).join('');
        if (msg.components?.length) content += msg.components.map(c => renderComponentRow(c, msg)).join('');
    }

    content += renderReactions(msg.reactions);

    if (isFirst) {
        const botTag = msg.author.bot
            ? `<span class="bot-tag${msg.author.system ? ' sys' : ''}">APP</span>`
            : '';
        return `<div class="msg msg-first" id="m-${esc(msg.id)}">
  <div class="av-col"><img class="avatar" src="${esc(av)}" alt="${esc(name)}" loading="lazy"></div>
  <div class="msg-body">
    <div class="msg-header">
      <span class="msg-name" style="color:${esc(color)}">${esc(name)}</span>${botTag}
      <span class="msg-ts">${esc(ts)}</span>
    </div>
    ${content}
  </div>
</div>`;
    }

    return `<div class="msg msg-cont" id="m-${esc(msg.id)}">
  <div class="av-col"><span class="cont-ts" title="${esc(ts)}">${esc(tsShort)}</span></div>
  <div class="msg-body">${content}</div>
</div>`;
}


const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#313338;--bg2:#2b2d31;--bg3:#1e1f22;
  --text:#dcddde;--muted:#949ba4;--link:#00a8fc;
  --border:#3f4147;--embed-bg:#2b2d31;--code-bg:#1e1f22;
  --mention:#5865f2;--mention-bg:rgba(88,101,242,.3);
}
body{background:var(--bg);color:var(--text);font-family:"gg sans","Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.375}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
strong{font-weight:700}em{font-style:italic}u{text-decoration:underline}s{text-decoration:line-through}

/* Layout */
.wrap{max-width:1280px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}

/* Header */
.t-header{background:var(--bg3);padding:16px 20px;display:flex;align-items:center;gap:12px;border-bottom:2px solid var(--border);position:sticky;top:0;z-index:10}
.guild-icon{width:48px;height:48px;border-radius:50%;flex-shrink:0;object-fit:cover}
.t-info{flex:1}
.t-guild{font-weight:700;font-size:15px;color:#f2f3f5}
.t-channel{font-size:13px;color:var(--muted)}
.t-meta{font-size:12px;color:var(--muted);text-align:right;display:flex;flex-direction:column;gap:2px}

/* Messages */
.messages{flex:1;padding:16px 0}
.date-sep{display:flex;align-items:center;gap:8px;padding:16px 20px;user-select:none}
.date-sep hr{flex:1;border:none;border-top:1px solid var(--border)}
.date-sep-label{font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap}

.msg{display:flex;padding:2px 20px 2px 20px;gap:16px}
.msg:hover{background:rgba(4,4,5,.07)}
.msg-first{padding-top:14px;margin-top:6px}
.av-col{width:40px;flex-shrink:0;display:flex;justify-content:center;align-items:flex-start;padding-top:1px}
.avatar{width:40px;height:40px;border-radius:50%;object-fit:cover}
.cont-ts{font-size:11px;color:var(--muted);opacity:0;line-height:1.375;padding-top:4px;white-space:nowrap}
.msg:hover .cont-ts{opacity:1}
.msg-body{flex:1;min-width:0}
.msg-header{display:flex;align-items:baseline;gap:8px;margin-bottom:2px;flex-wrap:wrap}
.msg-name{font-weight:500;font-size:16px}
.bot-tag{font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;background:var(--mention);color:#fff;letter-spacing:.3px;vertical-align:middle}
.bot-tag.sys{background:#4f545c}
.msg-ts{font-size:11px;color:var(--muted)}
.msg-content{word-break:break-word}
.msg-content:empty{display:none}

/* System messages */
.msg-system{display:flex;align-items:center;gap:8px;padding:6px 20px;font-size:14px;color:var(--muted)}
.sys-icon{flex-shrink:0}
.sys-text{flex:1}
.sys-ts{font-size:11px;white-space:nowrap}

/* Markdown */
.inline-code{background:var(--code-bg);padding:.15em .3em;border-radius:3px;font-family:Consolas,"Liberation Mono",Menlo,Courier,monospace;font-size:.875em}
.code-block{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin:4px 0;overflow-x:auto;font-family:Consolas,"Liberation Mono",Menlo,Courier,monospace;font-size:.875em}
.code-lang{font-size:11px;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.emoji{width:1.375em;height:1.375em;object-fit:contain;vertical-align:-.3em}
.mention{background:var(--mention-bg);color:#c9cdfb;padding:0 3px;border-radius:3px;font-weight:500}
.mention:hover{background:rgba(88,101,242,.4)}
.timestamp{background:var(--bg2);padding:0 4px;border-radius:3px;font-size:.875em}
.subtext{font-size:12px;color:var(--muted)}
h1.md-h{font-size:24px;font-weight:700;border-bottom:1px solid var(--border);padding-bottom:4px;margin:4px 0}
h2.md-h{font-size:20px;font-weight:700;border-bottom:1px solid var(--border);padding-bottom:3px;margin:4px 0}
h3.md-h{font-size:16px;font-weight:700;margin:4px 0}
.blockquote{border-left:4px solid var(--border);padding-left:12px;margin:4px 0;color:var(--text)}
.spoiler{background:#1a1b1e;color:transparent;border-radius:3px;cursor:pointer;padding:0 3px;transition:background .1s,color .1s}
.spoiler.open{background:rgba(0,0,0,.3);color:inherit}

/* Attachments */
.attachment{margin:4px 0}
.att-img{max-width:400px;max-height:300px;border-radius:4px;display:block}
.att-file a{display:inline-flex;align-items:center;gap:8px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 14px;color:var(--text);text-decoration:none;font-size:14px}
.att-file a:hover{border-color:#6d6f78}
.att-file-icon{font-size:20px}
.att-file-name{color:var(--link)}
.att-file-size{color:var(--muted);font-size:12px}

/* Embeds */
.embed{background:var(--embed-bg);border-left:4px solid #4f545c;border-radius:0 8px 8px 0;padding:12px 16px 12px 12px;margin:4px 0;max-width:520px}
.embed-inner{display:flex;gap:12px}
.embed-body{flex:1;min-width:0}
.embed-thumb{flex-shrink:0}
.embed-thumb img{width:80px;height:80px;object-fit:cover;border-radius:4px}
.embed-author{display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:14px;font-weight:600;color:var(--text)}
.embed-author a{color:var(--text)}
.embed-icon{width:20px;height:20px;border-radius:50%;object-fit:cover}
.embed-title{font-size:16px;font-weight:700;margin-bottom:4px}
.embed-title a{color:var(--link)}
.embed-desc{font-size:14px;color:var(--text);margin-bottom:8px}
.embed-fields{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.embed-field{min-width:100%;font-size:14px}
.embed-field.inline{min-width:0;flex:1;max-width:50%}
.ef-name{font-weight:700;margin-bottom:2px;font-size:13px}
.ef-val{color:var(--text)}
.embed-img{margin-top:8px}
.embed-img img{max-width:400px;border-radius:4px}
.embed-footer{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin-top:8px}

/* Reactions */
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.reaction{display:inline-flex;align-items:center;gap:4px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:2px 10px;font-size:13px}
.rx-emoji{width:18px;height:18px;object-fit:contain;vertical-align:middle}
.rx-count{font-weight:500}

/* Reply */
.reply{margin-bottom:4px}
.reply-bar{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);padding-left:4px}
.reply-av{width:16px;height:16px;border-radius:50%;object-fit:cover}
.reply-name{font-weight:500;cursor:pointer}
.reply-snippet{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:350px}
.reply-unknown{font-style:italic}
.reply-sys-icon{font-size:12px}

/* Components V2 */
.v2-container{background:var(--bg2);border-left:3px solid var(--border);border-radius:0 8px 8px 0;padding:12px;margin:4px 0}
.v2-text{font-size:15px;line-height:1.5}
.v2-text+.v2-text{margin-top:6px}
.v2-section{display:flex;align-items:flex-start;gap:12px}
.v2-gallery{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.v2-gallery img{max-width:160px;max-height:160px;object-fit:cover;border-radius:4px}
.v2-sep{border:none;border-top:1px solid var(--border);margin:8px 0}
.section-thumbnail img{width:80px;height:80px;object-fit:cover;border-radius:4px;flex-shrink:0}

/* Buttons / select */
.action-row{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}
.discord-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:8px;font-size:14px;font-weight:500;border:none;opacity:.75;cursor:default;font-family:inherit}
.btn-primary{background:#5865f2;color:#fff}
.btn-secondary{background:#4f545c;color:#fff}
.btn-success{background:#248046;color:#fff}
.btn-danger{background:#da373c;color:#fff}
.btn-link{background:transparent;border:1px solid #4f545c!important;color:var(--text)}
.btn-emoji{width:18px;height:18px;object-fit:contain;vertical-align:middle}
.ext-icon{opacity:.7;flex-shrink:0}
.select-menu{display:inline-flex;align-items:center;justify-content:space-between;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 12px;min-width:200px;max-width:400px;font-size:14px;color:var(--muted);opacity:.8}
.sel-arrow{font-size:12px;margin-left:8px}

/* Stickers */
.sticker{width:128px;height:128px;object-fit:contain;margin-top:4px}

/* Footer */
.t-footer{background:var(--bg3);padding:12px 20px;text-align:center;font-size:12px;color:var(--muted);border-top:1px solid var(--border)}
`;

function buildHtml(msgs, channel, body) {
    const guildName = channel.guild?.name || 'Direct Messages';
    const channelName = channel.name || 'channel';
    const iconUrl = channel.guild?.iconURL({ size: 64, extension: 'webp' }) || '';
    const count = msgs.length;
    const exportDate = fmtTime(new Date());

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https://cdn.discordapp.com https://media.discordapp.net; style-src 'unsafe-inline'; script-src 'none'">
<title>Transcript — #${esc(channelName)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="t-header">
    ${iconUrl ? `<img class="guild-icon" src="${esc(iconUrl)}" alt="${esc(guildName)}">` : ''}
    <div class="t-info">
      <div class="t-guild">${esc(guildName)}</div>
      <div class="t-channel"># ${esc(channelName)}</div>
    </div>
    <div class="t-meta">
      <span>${count} message${count !== 1 ? 's' : ''}</span>
      <span>Exported ${esc(exportDate)}</span>
    </div>
  </div>
  <div class="messages">${body}</div>
  <div class="t-footer">OptiDesk Secure Transcript &mdash; Your access is timed and recorded.</div>
</div>
</body>
</html>`;
}


const DISCORD_CDN = /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\//;
const SAFE_IMAGE_CT = /^image\/(png|jpe?g|gif|webp|avif)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // per image
const MAX_EMBED_BYTES = 50 * 1024 * 1024;  // total across all images
const MAX_EMBED_IMAGES = 200;              // max unique images to fetch
const FETCH_CONCURRENCY = 8;              // simultaneous outbound connections

// Paths always embedded regardless of trusted mode: emojis, user/guild avatars, guild icon
const ALWAYS_EMBED = /^https:\/\/cdn\.discordapp\.com\/(?:emojis\/|avatars\/|embed\/avatars\/|icons\/|guilds\/[^/]+\/users\/[^/]+\/avatars\/)/;

// Fetch a Discord CDN image. Never follows redirects to non-CDN URLs (SSRF guard)
function fetchBuffer(rawUrl, redirectsLeft = 3) {
    return new Promise((resolve) => {
        if (!DISCORD_CDN.test(rawUrl)) return resolve(null); // reject non-CDN at every hop
        try {
            // Always HTTPS — Discord CDN doesn't serve over plain HTTP
            const req = https.get(rawUrl, { timeout: 10000 }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const loc = res.headers.location;
                    res.resume();
                    // Re-validate redirect target is still a Discord CDN URL
                    if (loc && redirectsLeft > 0 && DISCORD_CDN.test(loc)) {
                        return resolve(fetchBuffer(loc, redirectsLeft - 1));
                    }
                    return resolve(null);
                }
                if (res.statusCode !== 200) { res.resume(); return resolve(null); }

                // Validate content-type before buffering, reject SVG and non-image types
                const ct = (res.headers['content-type'] || '').split(';')[0].trim();
                if (!SAFE_IMAGE_CT.test(ct)) { res.resume(); return resolve(null); }

                const chunks = [];
                let size = 0;
                res.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > MAX_IMAGE_BYTES) { req.destroy(); resolve(null); }
                    else chunks.push(chunk);
                });
                res.on('end', () => resolve({ buf: Buffer.concat(chunks), ct }));
                res.on('error', () => resolve(null));
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
        } catch {
            resolve(null);
        }
    });
}

// VERY LOUD WARNING:
// Things happen, and sometimes people send harmful content inside tickets. However, OptiDesk **ENFORCES** transcription.
// If a user sends harmful content into a ticket, and trustedOnly is true, you will be holding that content inside a
// transcript unless you actually delete the thread and circumvent OptiDesk. If you do not want to store images, but
// accept the shortcoming of relying on the CDN URLs that expire images after 24 hours, then set trustedOnly to false
// by either modifying the code below, or changing your configuration so transcriptsTrusted is false.
//
// This feature is a best-effort attempt to avoid saving harmful content, but has its shortfalls, and may not
// save you from capturing text or URLs that are harmful.
async function embedImages(html, trustedOnly = false) {
    const urls = new Set();
    const findRe = /src="(https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)[^"]+)"/g;
    let m;
    while ((m = findRe.exec(html)) !== null) {
        const url = m[1];
        if (!trustedOnly || ALWAYS_EMBED.test(url)) urls.add(url);
        if (urls.size >= MAX_EMBED_IMAGES) break; // cap unique image count
    }
    if (!urls.size) return html;

    // Fetch with bounded concurrency
    const urlList = [...urls];
    const map = new Map();
    let totalBytes = 0;
    for (let i = 0; i < urlList.length; i += FETCH_CONCURRENCY) {
        const batch = urlList.slice(i, i + FETCH_CONCURRENCY);
        const results = await Promise.all(batch.map(url => fetchBuffer(url)));
        for (let j = 0; j < batch.length; j++) {
            const result = results[j];
            if (!result) continue;
            totalBytes += result.buf.length;
            if (totalBytes > MAX_EMBED_BYTES) break; // stop embedding once aggregate cap hit
            map.set(batch[j], `data:${result.ct};base64,${result.buf.toString('base64')}`);
        }
        if (totalBytes > MAX_EMBED_BYTES) break;
    }

    return html.replace(/src="(https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)[^"]+)"/g,
        (full, url) => map.has(url) ? `src="${map.get(url)}"` : full
    );
}

async function generateTranscript(messages, channel, trusted = false) {
    const msgs = messages instanceof Collection
        ? [...messages.values()]
        : (Array.isArray(messages) ? messages : [...messages.values()]);

    msgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    let body = '';
    let prevMsg = null;
    let prevDate = null;

    for (const msg of msgs) {
        if (!prevDate || !sameDay(prevDate, msg.createdAt)) {
            body += `<div class="date-sep"><hr><span class="date-sep-label">${esc(fmtDate(msg.createdAt))}</span><hr></div>`;
            prevDate = msg.createdAt;
        }
        body += renderMessage(msg, !sameGroup(prevMsg, msg));
        prevMsg = msg;
    }

    const rawHtml = buildHtml(msgs, channel, body);
    const finalHtml = await embedImages(rawHtml, !trusted);
    return Buffer.from(finalHtml, 'utf-8');
}

module.exports = { generateTranscript };
