import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  EnvelopeSimple,
  FileText,
  Microphone,
  Paperclip,
  ShieldCheck,
  Sparkle,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { localModelProvider } from "../../ai/modelProvider.js";
import "./AssistantWorkspace.css";

function formatAnswerTime(value) {
  if (!value) return "尚无可用时间";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 19).replace("T", " ");
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function AssistantWorkspace({
  snapshot,
  onVoice,
  onImportMarkdown,
  onExportMarkdown,
  aiInboxCount = 0,
  onOpenInbox = () => {},
  companion = null,
}) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    setResult(null);
  }, [snapshot.accounts, snapshot.balances, snapshot.reminders, snapshot.transactions]);

  const ask = (event) => {
    event.preventDefault();
    if (!question.trim()) return;
    setResult(localModelProvider.answer_ledger({
      question: question.trim(),
      snapshot,
      now: new Date(),
    }));
  };

  return (
    <section className="assistant-workspace">
      <div className="assistant-hero">
        <div className="assistant-mark"><Sparkle weight="fill" /></div>
        <span>Folio AI 管家</span>
        <h2>用自然语言，管理你的每一笔钱</h2>
        <p>说一笔、写一句，或导入 Markdown。所有变化都会先生成核对内容，确认后才写入。</p>
        <form className="assistant-composer" onSubmit={ask}>
          <button type="button" className="assistant-attach" onClick={onImportMarkdown} aria-label="导入 Markdown">
            <Paperclip />
          </button>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value.slice(0, 500))}
            maxLength={500}
            placeholder="例如：这个月支出多少？也可以直接说一笔新记录…"
            aria-label="向 AI 管家提问"
          />
          <button type={question.trim() ? "submit" : "button"} className="assistant-mic" onClick={question.trim() ? undefined : onVoice} aria-label={question.trim() ? "发送问题" : "开始语音记录"}>
            {question.trim() ? <ArrowRight weight="bold" /> : <Microphone weight="fill" />}
          </button>
        </form>
        {companion && <div className="assistant-companion">{companion}</div>}
      </div>

      <div className="assistant-capabilities">
        <button type="button" onClick={onVoice}>
          <span><Microphone weight="duotone" /></span>
          <b>语音与文字记账</b>
          <small>先识别并生成待核对内容，不会直接改数据。</small>
        </button>
        <article>
          <span><FileText weight="duotone" /></span>
          <b>Markdown 数据</b>
          <small>一次导入完整资料，也可以随时按同一格式导出。</small>
          <div>
            <button type="button" onClick={onImportMarkdown}><UploadSimple /> 导入</button>
            <button type="button" onClick={onExportMarkdown}><ArrowRight /> 导出</button>
          </div>
        </article>
        <button type="button" onClick={onOpenInbox}>
          <span><EnvelopeSimple weight="duotone" /></span>
          <b>QQ 邮箱待核对</b>
          <small>{aiInboxCount > 0 ? `${aiInboxCount} 条识别结果等待处理。` : "只读识别信用卡邮件，后续由你确认。"}</small>
        </button>
      </div>

      <div className="assistant-guardrail">
        <ShieldCheck weight="duotone" />
        <span><b>每次写入都需确认</b><small>AI、语音、文件和邮箱只生成待核对内容；不会自动改变账户余额。</small></span>
        <i>已开启</i>
      </div>

      {result && (
        <article className={`local-assistant-answer ${result.status}`}>
          <header>
            <span>{result.status === "answered" ? <Check weight="bold" /> : <WarningCircle weight="fill" />}</span>
            <div>
              <small>{result.status === "answered" ? "已从当前数据计算" : "没有执行推测"}</small>
              <h3>{result.answer}</h3>
            </div>
          </header>
          {result.metrics?.length > 0 && (
            <div className="local-assistant-metrics">
              {result.metrics.map((item) => (
                <div key={`${item.label}:${item.value}`} className={item.tone ?? ""}>
                  <small>{item.label}</small><b>{item.value}</b>{item.detail && <span>{item.detail}</span>}
                </div>
              ))}
            </div>
          )}
          {result.citations?.length > 0 ? (
            <>
              <div className="local-assistant-source-coverage"><ShieldCheck weight="fill" /><span>已展示 {result.citations.length} / {result.sourceCount || result.citations.length} 个计算来源</span></div>
              <div className="local-assistant-citations">
                {result.citations.map((item) => (
                  <div key={`${item.refType}:${item.refId}`}>
                    <span><FileText weight="duotone" /></span>
                    <p><b>{item.label}</b><small>{item.summary}</small></p>
                    <time>{formatAnswerTime(item.dataAt)}</time>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="local-assistant-no-citation"><ShieldCheck weight="duotone" />没有来源就不会编造数据</div>
          )}
          <footer><span>数据时间：{formatAnswerTime(result.dataUpdatedAt)}</span><span>计算时间：{formatAnswerTime(result.computedAt)}</span></footer>
        </article>
      )}
    </section>
  );
}
