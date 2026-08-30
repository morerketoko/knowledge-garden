/** Phase 10：Relationship Lifecycle（Provenance / User Confirmed Relations）。
 * - AI 推断 ≠ 用户认可 ≠ 真实 WikiLink（§二）；只有 user_confirmed 才进入长期结构（§七/八十二）。
 * - Relationship Store 独立于 AI Cache（§十一：清空 AI Cache 不删 user_confirmed）。
 * - 确认关系必须最终有 Markdown 可恢复表达（§五十三/五十五），但绝不自动修改原始笔记（§八/六十）。
 * - 所有 add/confirm/dismiss/load 都是 AI request = 0（§六十七/七十七）。
 * - 纯函数（无 Obsidian DOM 依赖），便于 Node 自动测试（§七十四）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { KnowledgeRelationship, RelationshipDirection, RelationshipEvidence, SuggestedRelationship } from './types';
import { atomicWriteJson, isolateCorruptFile } from './migrations';

export const RELATIONSHIPS_FORMAT_VERSION = 1;   // §七十一：relationshipsFormatVersion = 1

/** 归一化路径：\ → /、trim；比较用 */
export function relNormPath(p: string): string {
  return (p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** 节点 key（无向判定 §十八）：去 .md、basename 小写 */
export function relNodeKey(p: string): string {
  const t = relNormPath(p).replace(/\.md$/i, '').split('/').pop() || '';
  return t.toLowerCase();
}

/** 无向键：A--B 与 B--A 同一键（§十八） */
export function relUndirectedKey(from: string, to: string): string {
  const a = relNormPath(from);
  const b = relNormPath(to);
  return a <= b ? a + '--' + b : b + '--' + a;
}

/** 关系文案归一化（判重 §五）：trim + 空白折叠 + 小写 */
export function relNormRelation(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** §十六：Relationship ID = sha256(归一化 from+to+relation)。bidirectional → 无向键（§十八）。 */
export function relationshipId(from: string, to: string, relation: string, direction: RelationshipDirection): string {
  const key = direction === 'bidirectional' ? relUndirectedKey(from, to) : relNormPath(from) + '--' + relNormPath(to);
  return crypto.createHash('sha256').update(key + '\u0000' + relation.trim(), 'utf8').digest('hex');
}

/** 判重：无向键相同 且 关系文案归一化相同 → 同一条关系（§五：不重复） */
export function relIsSame(a: { from: string; to: string; relation: string }, b: { from: string; to: string; relation: string }): boolean {
  return relUndirectedKey(a.from, a.to) === relUndirectedKey(b.from, b.to)
    && relNormRelation(a.relation) === relNormRelation(b.relation);
}

/** 文件名安全化（§五十四：module-boundary--decoupling.md 风格；防路径注入 §七十二） */
export function relSafeFileName(s: string, max = 48): string {
  const t = (s || 'relationship')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '-')
    .trim()
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'relationship';
  return t;
}

/** 节点显示名（wikilink 用 basename，不带 .md） */
export function relNodeLabel(p: string): string {
  return (relNormPath(p).split('/').pop() || p).replace(/\.md$/i, '');
}

/** 解析 wikilink 文本：[[A|alias]] / [[A#heading]] → A */
export function relWikiTitle(s: string): string {
  return (s || '').trim().replace(/^\[+/, '').replace(/\]+$/, '').split('|')[0].split('#')[0].trim();
}

/* ---------- 关系 Markdown（§五十四：用户可读长期资产 + 恢复源 §五十五） ---------- */

/** 解析后的关系 Markdown（frontmatter + 正文拆出；from/to 为 wikilink basename，不带 .md） */
export interface ParsedRelationshipMarkdown {
  id?: string;
  from: string;
  to: string;
  relation: string;
  reason?: string;
  direction: RelationshipDirection;
  status: 'active' | 'dismissed';
  createdAt?: number;
  updatedAt?: number;
}

/** 取 frontmatter 简单值：key: value（右侧 trim） */
function relFmValue(fm: string, key: string): string | undefined {
  const line = fm.split(/\r?\n/).find((l) => l.startsWith(key + ':'));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

/** 生成关系 Markdown（§五十四 结构；dismissed 不落盘 §五十七 —— 调用方只对 active 调用） */
export function buildRelationshipMarkdown(rel: KnowledgeRelationship): string {
  const evLines = rel.evidence.map((e) => '  - ' + e);
  const fm = [
    '---',
    'type: knowledge-relationship',
    'relationshipId: ' + rel.id,
    'status: ' + rel.status,
    'direction: ' + rel.direction,
    'evidence:',
    ...evLines,
    'createdAt: ' + rel.createdAt,
    ...(rel.updatedAt ? ['updatedAt: ' + rel.updatedAt] : []),
    '---',
    '',
    '# ' + relNodeLabel(rel.from) + ' ↔ ' + relNodeLabel(rel.to),
    '',
    '## 关系',
    '',
    rel.relation,
    '',
    '## 说明',
    '',
    (rel.reason && rel.reason.trim() ? rel.reason.trim() : '（无）'),
    '',
    '## 来源节点',
    '',
    '[[' + relNodeLabel(rel.from) + ']]',
    '[[' + relNodeLabel(rel.to) + ']]',
    '',
  ].join('\n');
  return fm + '\n';
}

/** 解析关系 Markdown（§五十五 恢复 / §五十九 rename 后仍凭 relationshipId 识别） */
export function parseRelationshipMarkdown(md: string): ParsedRelationshipMarkdown | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1];
  if (!/^type:\s*knowledge-relationship\s*$/m.test(fm)) return null;
  const body = m[2];
  const id = relFmValue(fm, 'relationshipId');
  const status = /^status:\s*dismissed\s*$/m.test(fm) ? 'dismissed' : 'active';
  const dir = relFmValue(fm, 'direction');
  const direction = dir === 'forward' ? 'forward' : 'bidirectional';
  const createdAt = Number(relFmValue(fm, 'createdAt') || 0) || undefined;
  const updatedAt = Number(relFmValue(fm, 'updatedAt') || 0) || undefined;
  // 来源节点：## 来源节点 下的 wikilinks（前两个）
  const nodesSec = body.match(/##\s*来源节点\s*\n([\s\S]*?)(?:\n##\s|$)/);
  const wikiLinks: string[] = [];
  if (nodesSec) {
    const re = /\[\[([^\]|#]+)(?:\|[^\]]+)?(?:#[^\]]+)?\]\]/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(nodesSec[1])) && wikiLinks.length < 2) {
      const t = relWikiTitle(mm[0]);
      if (t && !wikiLinks.includes(t)) wikiLinks.push(t);
    }
  }
  if (wikiLinks.length < 2) return null;
  const relationSec = body.match(/##\s*关系\s*\n([\s\S]*?)(?:\n##\s|$)/);
  const relation = (relationSec ? relationSec[1].split(/\r?\n/).map((x) => x.trim()).find(Boolean) : '') || '';
  if (!relation) return null;
  const reasonSec = body.match(/##\s*说明\s*\n([\s\S]*?)(?:\n##\s|$)/);
  const reason = reasonSec ? reasonSec[1].split(/\r?\n/).map((x) => x.trim()).find(Boolean) : undefined;
  return {
    ...(id ? { id } : {}),
    from: wikiLinks[0],
    to: wikiLinks[1],
    relation,
    ...(reason && reason !== '（无）' ? { reason } : {}),
    direction,
    status,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

/* ---------- RelationshipStore（§九：cache/relationships.json；Map 索引 §六十八/六十九） ---------- */

/** 关系文件路径（§十：baseDir/cache/relationships.json；与 AI Cache 分离 §十一） */
export function relStoreFilePath(baseDir: string): string {
  return baseDir + '/cache/relationships.json';
}

/** 构造正式关系（§四：evidence 去重合并 §五/十九/二十/二十一；id §十六；默认证据 user_confirmed §七） */
export function createRelationship(input: {
  from: string;
  to: string;
  relation: string;
  reason?: string;
  evidence?: RelationshipEvidence[];
  direction: RelationshipDirection;
}): KnowledgeRelationship {
  const ev = Array.from(new Set(input.evidence && input.evidence.length ? input.evidence : ['user_confirmed'])) as RelationshipEvidence[];
  const now = Date.now();
  return {
    id: relationshipId(input.from, input.to, input.relation, input.direction),
    from: relNormPath(input.from).replace(/\.md$/i, '') + '.md',
    to: relNormPath(input.to).replace(/\.md$/i, '') + '.md',
    relation: input.relation.trim(),
    ...(input.reason && input.reason.trim() ? { reason: input.reason.trim() } : {}),
    evidence: ev.length ? ev : ['user_confirmed'],
    direction: input.direction,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

/** KnowledgeRelationship Store：独立持久化（§九/十）；0 AI（§六十七/七十七）；Map 索引 10k 规模（§六十八/六十九）。 */
export class RelationshipStore {
  private rels: KnowledgeRelationship[] = [];
  private dirty = false;
  private readonly filePath: string;
  private byId = new Map<string, KnowledgeRelationship>();
  private byNode = new Map<string, Set<string>>();   // relNodeKey → ids

  constructor(baseDir: string) {
    this.filePath = relStoreFilePath(baseDir);
  }

  private rebuildIndex(): void {
    this.byId = new Map();
    this.byNode = new Map();
    for (const r of this.rels) {
      this.byId.set(r.id, r);
      for (const k of [relNodeKey(r.from), relNodeKey(r.to)]) {
        const s = this.byNode.get(k) ?? new Set<string>();
        s.add(r.id);
        this.byNode.set(k, s);
      }
    }
  }

  /** 损坏 → 隔离 + 空（§五十二）；返回是否损坏 */
  load(): boolean {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const obj = JSON.parse(raw) as { relationships?: KnowledgeRelationship[] };
      this.rels = Array.isArray(obj.relationships) ? this.filterValid(obj.relationships) : [];
      this.rebuildIndex();
      this.dirty = false;
      return false;
    } catch {
      isolateCorruptFile(this.filePath);
      this.rels = [];
      this.rebuildIndex();
      this.dirty = true;
      return true;
    }
  }

  /** 防御（§七十二：path 只允许 Vault 真实路径；结构不合法条目丢弃） */
  private filterValid(list: KnowledgeRelationship[]): KnowledgeRelationship[] {
    const seen = new Set<string>();
    const out: KnowledgeRelationship[] = [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const from = typeof r.from === 'string' ? relNormPath(r.from) : '';
      const to = typeof r.to === 'string' ? relNormPath(r.to) : '';
      const relation = typeof r.relation === 'string' ? r.relation.trim() : '';
      if (!from || !to || !relation || relNodeKey(from) === relNodeKey(to)) continue;
      const status = r.status === 'dismissed' ? 'dismissed' : 'active';
      const direction = r.direction === 'forward' ? 'forward' : 'bidirectional';
      const evidence = Array.isArray(r.evidence)
        ? r.evidence.filter((e): e is RelationshipEvidence => e === 'wikilink' || e === 'ai_inferred' || e === 'user_confirmed')
        : [];
      const id = r.id && typeof r.id === 'string' && r.id.length >= 8 ? r.id : relationshipId(from, to, relation, direction);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        from: from.replace(/\.md$/i, '') + '.md',
        to: to.replace(/\.md$/i, '') + '.md',
        relation,
        ...(typeof r.reason === 'string' && r.reason.trim() ? { reason: r.reason.trim() } : {}),
        evidence: evidence.length ? evidence : ['ai_inferred'],
        direction,
        status,
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
        updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
        ...(typeof r.dismissedAt === 'number' ? { dismissedAt: r.dismissedAt } : {}),
      });
    }
    return out;
  }

  flush(): void {
    if (!this.dirty) return;
    atomicWriteJson(this.filePath, { formatVersion: RELATIONSHIPS_FORMAT_VERSION, relationships: this.rels } as never);
    this.dirty = false;
  }

  all(): KnowledgeRelationship[] { return this.rels; }
  count(): number { return this.rels.length; }
  get(id: string): KnowledgeRelationship | undefined { return this.byId.get(id); }
  active(): KnowledgeRelationship[] { return this.rels.filter((r) => r.status === 'active'); }
  confirmed(): KnowledgeRelationship[] { return this.rels.filter((r) => r.status === 'active' && r.evidence.includes('user_confirmed')); }
  dismissed(): KnowledgeRelationship[] { return this.rels.filter((r) => r.status === 'dismissed'); }

  /** §六十九：byNode 索引 —— O(1) 取某节点关联关系 */
  findByNode(p: string): KnowledgeRelationship[] {
    const key = relNodeKey(p);
    const ids = this.byNode.get(key);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.byId.get(id)).filter((x): x is KnowledgeRelationship => !!x);
  }

  /** §六十八 findBetween：两节点间的关系（无向 §十八） */
  findBetween(from: string, to: string): KnowledgeRelationship[] {
    const a = relNodeKey(from);
    const b = relNodeKey(to);
    if (a === b) return [];
    const ids = this.byNode.get(a);
    if (!ids) return [];
    const out: KnowledgeRelationship[] = [];
    for (const id of ids) {
      const r = this.byId.get(id);
      if (!r) continue;
      const k1 = relNodeKey(r.from);
      const k2 = relNodeKey(r.to);
      if ((k1 === a && k2 === b) || (k1 === b && k2 === a)) out.push(r);
    }
    return out;
  }

  /** §五/十六：同 id → 现有；否则按「无向键 + 归一化文案」判重（§十八） */
  private existingByRel(from: string, to: string, relation: string, direction: RelationshipDirection): KnowledgeRelationship | undefined {
    const byId = this.byId.get(relationshipId(from, to, relation, direction));
    if (byId) return byId;
    return this.rels.find((r) => relIsSame(r, { from, to, relation }));
  }

  /** §二十一：用户确认 → 创建/升级 active（evidence 合并不重复 §七/Test 5/7；dismissed 再确认重新激活 §十五） */
  confirm(input: {
    from: string;
    to: string;
    relation: string;
    reason?: string;
    evidence?: RelationshipEvidence[];
    direction?: RelationshipDirection;
  }): KnowledgeRelationship {
    const direction = input.direction === 'forward' ? 'forward' : 'bidirectional';
    const evBase: RelationshipEvidence[] = input.evidence && input.evidence.length ? input.evidence : ['user_confirmed'];
    const existing = this.existingByRel(input.from, input.to, input.relation, direction);
    if (existing) {
      if (existing.status === 'dismissed') {
        existing.status = 'active';
        delete existing.dismissedAt;
      }
      existing.evidence = Array.from(new Set([...existing.evidence, ...evBase])) as RelationshipEvidence[];
      existing.updatedAt = Date.now();
      if (!existing.reason && input.reason && input.reason.trim()) existing.reason = input.reason.trim();
      this.dirty = true;
      this.flush();
      return existing;
    }
    const rel = createRelationship({ from: input.from, to: input.to, relation: input.relation, ...(input.reason ? { reason: input.reason } : {}), evidence: evBase, direction });
    this.rels.push(rel);
    this.rebuildIndex();
    this.dirty = true;
    this.flush();
    return rel;
  }

  /** §十三/十四：忽略建议 → 记录 dismissed（不删 AI Cache；不写 Markdown §五十七） */
  dismiss(input: { from: string; to: string; relation: string; direction?: RelationshipDirection }): KnowledgeRelationship {
    const direction = input.direction === 'forward' ? 'forward' : 'bidirectional';
    const existing = this.existingByRel(input.from, input.to, input.relation, direction);
    if (existing) {
      existing.status = 'dismissed';
      existing.updatedAt = Date.now();
      existing.dismissedAt = Date.now();
      this.dirty = true;
      this.flush();
      return existing;
    }
    const rel = createRelationship({ from: input.from, to: input.to, relation: input.relation, evidence: ['ai_inferred'], direction });
    rel.status = 'dismissed';
    rel.updatedAt = Date.now();
    rel.dismissedAt = Date.now();
    this.rels.push(rel);
    this.rebuildIndex();
    this.dirty = true;
    this.flush();
    return rel;
  }

  /** 删除（§五十八：用户删 Markdown → 同步移除） */
  remove(id: string): boolean {
    const before = this.rels.length;
    this.rels = this.rels.filter((r) => r.id !== id);
    if (this.rels.length !== before) {
      this.rebuildIndex();
      this.dirty = true;
      this.flush();
      return true;
    }
    return false;
  }

  /** 来源笔记删除（Test 14）：相关关系一并移除，不崩溃 */
  removeNode(p: string): void {
    const key = relNodeKey(p);
    const before = this.rels.length;
    this.rels = this.rels.filter((r) => relNodeKey(r.from) !== key && relNodeKey(r.to) !== key);
    if (this.rels.length !== before) {
      this.rebuildIndex();
      this.dirty = true;
      this.flush();
    }
  }

  /** §五十九/Test 13：来源笔记 rename → 更新 from/to（id 随 §十六 重算；md 由 Obsidian 自动改 wikilink） */
  migratePaths(oldPath: string, newPath: string): void {
    let changed = false;
    for (const r of this.rels) {
      if (relNormPath(r.from) === relNormPath(oldPath)) { r.from = relNormPath(newPath).replace(/\.md$/i, '') + '.md'; changed = true; }
      if (relNormPath(r.to) === relNormPath(oldPath)) { r.to = relNormPath(newPath).replace(/\.md$/i, '') + '.md'; changed = true; }
    }
    if (changed) {
      for (const r of this.rels) {
        const nextId = relationshipId(r.from, r.to, r.relation, r.direction);
        if (nextId !== r.id) r.id = nextId;
      }
      this.rebuildIndex();
      this.dirty = true;
      this.flush();
    }
  }

  /** §五十五/五十八（Test 11/12）：以当前 Relationships/*.md 解析集为准重建 confirmed（dismissed 保留；
   *  md 已删的 confirmed 移除且不自动重建；md 新增的 confirmed 补入）。resolve：basename → Vault 真实路径。 */
  reconcileFromMarkdown(parsed: ParsedRelationshipMarkdown[], resolve: (basename: string) => string | undefined): void {
    const kept: KnowledgeRelationship[] = [];
    for (const r of this.rels) { if (r.status === 'dismissed') kept.push(r); }
    const mdById = new Map<string, ParsedRelationshipMarkdown>();
    const mdKeySet = new Set<string>();
    for (const p of parsed) {
      const from = resolve(p.from);
      const to = resolve(p.to);
      if (!from || !to || relNodeKey(from) === relNodeKey(to)) continue;
      const id = p.id && p.id.length >= 8 ? p.id : relationshipId(from, to, p.relation, p.direction);
      mdById.set(id, p);
      mdKeySet.add(id);
      mdKeySet.add(relUndirectedKey(from, to) + '||' + relNormRelation(p.relation));
    }
    for (const r of this.rels) {
      if (r.status !== 'active' || !r.evidence.includes('user_confirmed')) continue;
      const key = relUndirectedKey(r.from, r.to) + '||' + relNormRelation(r.relation);
      if (mdKeySet.has(r.id) || mdKeySet.has(key)) kept.push(r);   // md 仍存在 → 保留原条（§五十八 不重复）
      // 否则 md 已删 → 不保留（不自动重建 §五十八/六十）
    }
    for (const [id, p] of mdById) {
      if (kept.some((k) => k.id === id)) continue;
      const from = resolve(p.from);
      const to = resolve(p.to);
      if (!from || !to || relNodeKey(from) === relNodeKey(to)) continue;
      const rel = createRelationship({ from, to, relation: p.relation, ...(p.reason ? { reason: p.reason } : {}), evidence: ['user_confirmed'], direction: p.direction });
      if (p.id && p.id.length >= 8) rel.id = p.id;   // §五十九：frontmatter id 优先（rename 后可识别）
      rel.createdAt = p.createdAt ?? rel.createdAt;
      rel.updatedAt = p.updatedAt ?? rel.updatedAt;
      kept.push(rel);
    }
    const seen = new Set<string>();
    const out: KnowledgeRelationship[] = [];
    for (const r of kept) { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } }
    this.rels = out;
    this.rebuildIndex();
    this.dirty = true;
    this.flush();
  }

  /** §七十 Diagnostics（只作诊断数字） */
  stats(): { confirmed: number; activeAI: number; dismissed: number; total: number } {
    let confirmed = 0;
    let activeAI = 0;
    let dismissed = 0;
    for (const r of this.rels) {
      if (r.status === 'dismissed') dismissed++;
      else if (r.evidence.includes('user_confirmed')) confirmed++;
      else activeAI++;
    }
    return { confirmed, dismissed, activeAI, total: this.rels.length };
  }
}
