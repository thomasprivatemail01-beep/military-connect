import { useEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
} from "react";
import { io, type Socket } from "socket.io-client";
import "./App.css";

/* =========================================================
   BACKEND CONNECTION
========================================================= */

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000/api";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  "http://localhost:5000";

/* =========================================================
   TYPES
========================================================= */

interface User {
  id: number;
  fullName: string;
  email: string;
  createdAt?: string;
}

interface Message {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  messageType: "text" | "image";
  mediaUrl?: string | null;
  createdAt: string;
}

interface AuthResponse {
  success: boolean;
  message?: string;
  token?: string;
  user?: User;
}

interface SocketMessageResponse {
  success: boolean;
  message?: Message | string;
  error?: string;
}

interface ImageUploadResponse {
  success: boolean;
  message?: string;
  mediaUrl?: string;
}

/* =========================================================
   APP
========================================================= */

function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("military_connect_token")
  );

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const savedUser =
      localStorage.getItem(
        "military_connect_user"
      );

    if (!savedUser) {
      return null;
    }

    try {
      return JSON.parse(
        savedUser
      ) as User;
    } catch {
      return null;
    }
  });

  const [authMode, setAuthMode] =
    useState<"login" | "register">(
      "login"
    );

  const [authName, setAuthName] =
    useState("");

  const [authEmail, setAuthEmail] =
    useState("");

  const [authPassword, setAuthPassword] =
    useState("");

  const [authLoading, setAuthLoading] =
    useState(false);

  const [contacts, setContacts] =
    useState<User[]>([]);

  const [selectedContact, setSelectedContact] =
    useState<User | null>(null);

  const selectedContactRef =
    useRef<User | null>(null);

  const [messages, setMessages] =
    useState<Message[]>([]);

  const [messageText, setMessageText] =
    useState("");

  const [searchEmail, setSearchEmail] =
    useState("");

  const [searchResults, setSearchResults] =
    useState<User[]>([]);

  const [messagesLoading, setMessagesLoading] =
    useState(false);

  const [contactsLoading, setContactsLoading] =
    useState(false);

  const [searchLoading, setSearchLoading] =
    useState(false);

  const [addingContactId, setAddingContactId] =
    useState<number | null>(null);

  const [error, setError] =
    useState("");

  const [notice, setNotice] =
    useState("");

  const [imagePreview, setImagePreview] =
    useState<string | null>(null);

  const [selectedImageFile, setSelectedImageFile] =
    useState<File | null>(null);

  const [imageSending, setImageSending] =
    useState(false);

  const imageInputRef =
    useRef<HTMLInputElement | null>(
      null
    );

  const socketRef =
    useRef<Socket | null>(null);

  const messagesContainerRef =
    useRef<HTMLDivElement | null>(
      null
    );

  const messageInputRef =
    useRef<HTMLTextAreaElement | null>(
      null
    );

  /* =========================================================
     SELECTED CONTACT REF
  ========================================================= */

  useEffect(() => {
    selectedContactRef.current =
      selectedContact;
  }, [selectedContact]);

  /* =========================================================
     API HELPER
  ========================================================= */

  async function apiFetch(
    url: string,
    options: RequestInit = {}
  ) {
    const headers =
      new Headers(
        options.headers || {}
      );

    if (token) {
      headers.set(
        "Authorization",
        `Bearer ${token}`
      );
    }

    if (
      options.body &&
      !(options.body instanceof FormData)
    ) {
      headers.set(
        "Content-Type",
        "application/json"
      );
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }

  /* =========================================================
     AUTH
  ========================================================= */

  async function handleAuth(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setNotice("");
    setAuthLoading(true);

    try {
      const endpoint =
        authMode === "login"
          ? `${API_URL}/login`
          : `${API_URL}/register`;

      const body =
        authMode === "login"
          ? {
              email:
                authEmail
                  .trim()
                  .toLowerCase(),
              password:
                authPassword,
            }
          : {
              fullName:
                authName.trim(),
              email:
                authEmail
                  .trim()
                  .toLowerCase(),
              password:
                authPassword,
            };

      const response =
        await fetch(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(
              body
            ),
          }
        );

      const data =
        (await response.json()) as AuthResponse;

      if (
        !response.ok ||
        !data.success ||
        !data.token ||
        !data.user
      ) {
        setError(
          data.message ||
            "Unable to complete authentication."
        );

        return;
      }

      localStorage.setItem(
        "military_connect_token",
        data.token
      );

      localStorage.setItem(
        "military_connect_user",
        JSON.stringify(
          data.user
        )
      );

      setToken(data.token);
      setCurrentUser(
        data.user
      );

      setAuthPassword("");

      setNotice(
        authMode === "login"
          ? "Welcome back."
          : "Account created successfully."
      );
    } catch (authError) {
      console.error(
        authError
      );

      setError(
        "Unable to connect to Military Connect server."
      );
    } finally {
      setAuthLoading(false);
    }
  }

  /* =========================================================
     LOGOUT
  ========================================================= */

  function logout() {
    socketRef.current?.disconnect();

    localStorage.removeItem(
      "military_connect_token"
    );

    localStorage.removeItem(
      "military_connect_user"
    );

    setToken(null);
    setCurrentUser(null);
    setContacts([]);
    setSelectedContact(null);
    setMessages([]);
    setMessageText("");
    setSearchResults([]);
    setSearchEmail("");
    setError("");
    setNotice("");
  }

  /* =========================================================
     LOAD CONTACTS
  ========================================================= */

  async function loadContacts() {
    if (!token) {
      return;
    }

    setContactsLoading(true);

    try {
      const response =
        await apiFetch(
          `${API_URL}/contacts`
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "Unable to load contacts."
        );
      }

      setContacts(
        Array.isArray(
          data.contacts
        )
          ? data.contacts
          : []
      );
    } catch (loadError) {
      console.error(
        "LOAD CONTACTS ERROR:",
        loadError
      );

      setError(
        "Unable to load your contacts."
      );
    } finally {
      setContactsLoading(
        false
      );
    }
  }

  useEffect(() => {
    if (
      !token ||
      !currentUser
    ) {
      return;
    }

    void loadContacts();
  }, [
    token,
    currentUser,
  ]);

  /* =========================================================
     SOCKET CONNECTION
  ========================================================= */

  useEffect(() => {
    if (
      !token ||
      !currentUser
    ) {
      return;
    }

    const socket =
      io(SOCKET_URL, {
        auth: {
          token,
        },
        transports: [
          "websocket",
          "polling",
        ],
      });

    socketRef.current =
      socket;

    socket.on(
      "connect",
      () => {
        console.log(
          "Connected to Military Connect server"
        );
      }
    );

    socket.on(
      "connect_error",
      (socketError) => {
        console.error(
          "Socket connection error:",
          socketError
        );
      }
    );

    socket.on(
      "private_message",
      (message: Message) => {
        console.log(
          "PRIVATE MESSAGE RECEIVED:",
          message
        );

        addIncomingMessage(
          message
        );
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current =
        null;
    };
  }, [
    token,
    currentUser,
  ]);

  /* =========================================================
     ADD INCOMING MESSAGE
  ========================================================= */

  function addIncomingMessage(
    message: Message
  ) {
    const contact =
      selectedContactRef.current;

    if (
      !contact ||
      !currentUser
    ) {
      return;
    }

    const belongsToCurrentConversation =
      (message.senderId ===
        currentUser.id &&
        message.receiverId ===
          contact.id) ||
      (message.senderId ===
        contact.id &&
        message.receiverId ===
          currentUser.id);

    if (
      !belongsToCurrentConversation
    ) {
      return;
    }

    setMessages(
      (previous) => {
        if (
          previous.some(
            (item) =>
              item.id ===
              message.id
          )
        ) {
          return previous;
        }

        return [
          ...previous,
          message,
        ];
      }
    );

    setTimeout(() => {
      scrollToBottom();
    }, 50);
  }

  /* =========================================================
     LOAD CONVERSATION
  ========================================================= */

  async function loadConversation(
    contact: User
  ) {
    if (
      !token ||
      !currentUser
    ) {
      return;
    }

    setSelectedContact(
      contact
    );

    selectedContactRef.current =
      contact;

    setMessages([]);
    setMessagesLoading(
      true
    );

    setError("");
    setNotice("");

    try {
      const response =
        await apiFetch(
          `${API_URL}/messages/${contact.id}`
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "Unable to load messages."
        );
      }

      if (
        selectedContactRef
          .current?.id !==
        contact.id
      ) {
        return;
      }

      setMessages(
        Array.isArray(
          data.messages
        )
          ? data.messages
          : []
      );

      setTimeout(() => {
        scrollToBottom();
      }, 100);
    } catch (loadError) {
      console.error(
        "LOAD CONVERSATION ERROR:",
        loadError
      );

      setError(
        "Unable to load this conversation."
      );
    } finally {
      setMessagesLoading(
        false
      );
    }
  }

  /* =========================================================
     ADD CONTACT
  ========================================================= */

  async function addContact(
    user: User
  ) {
    console.log(
      "ADD BUTTON CLICKED:",
      user
    );

    if (!token) {
      setError(
        "Your session has expired. Please log in again."
      );

      return;
    }

    if (
      !user ||
      !user.id
    ) {
      setError(
        "Invalid user selected."
      );

      return;
    }

    setAddingContactId(
      user.id
    );

    setError("");
    setNotice("");

    try {
      console.log(
        "ADDING CONTACT ID:",
        user.id
      );

      const response =
        await apiFetch(
          `${API_URL}/contacts`,
          {
            method: "POST",
            body: JSON.stringify(
              {
                contactUserId:
                  user.id,
              }
            ),
          }
        );

      const data =
        await response.json();

      console.log(
        "ADD CONTACT RESPONSE:",
        response.status,
        data
      );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "Unable to add contact."
        );
      }

      setContacts(
        (previous) => {
          const alreadyExists =
            previous.some(
              (contact) =>
                contact.id ===
                user.id
            );

          if (
            alreadyExists
          ) {
            return previous;
          }

          return [
            ...previous,
            user,
          ].sort(
            (a, b) =>
              a.fullName.localeCompare(
                b.fullName
              )
          );
        }
      );

      setSearchResults([]);
      setSearchEmail("");

      setNotice(
        `${user.fullName} has been added to your contacts.`
      );

      await loadContacts();

      setSelectedContact(
        user
      );

      selectedContactRef.current =
        user;

      await loadConversation(
        user
      );
    } catch (
      contactError
    ) {
      console.error(
        "ADD CONTACT ERROR:",
        contactError
      );

      setError(
        contactError instanceof
          Error
          ? contactError.message
          : "Unable to add contact."
      );
    } finally {
      setAddingContactId(
        null
      );
    }
  }

  /* =========================================================
     SEARCH USER
  ========================================================= */

  async function searchUser(
    event?: FormEvent<HTMLFormElement>
  ) {
    event?.preventDefault();

    const email =
      searchEmail
        .trim()
        .toLowerCase();

    if (!email) {
      setSearchResults([]);
      setNotice("");

      return;
    }

    setSearchLoading(
      true
    );

    setError("");
    setNotice("");

    try {
      const response =
        await apiFetch(
          `${API_URL}/users/search?email=${encodeURIComponent(
            email
          )}`
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "Unable to search."
        );
      }

      const users: User[] =
        Array.isArray(
          data.users
        )
          ? data.users
          : [];

      setSearchResults(
        users
      );

      if (
        users.length === 0
      ) {
        setNotice(
          "No user found with that email address."
        );
      }
    } catch (
      searchError
    ) {
      console.error(
        "SEARCH ERROR:",
        searchError
      );

      setError(
        "Unable to search for that user."
      );
    } finally {
      setSearchLoading(
        false
      );
    }
  }

  /* =========================================================
     SCROLL
  ========================================================= */

  function scrollToBottom() {
    const container =
      messagesContainerRef.current;

    if (!container) {
      return;
    }

    container.scrollTo({
      top:
        container.scrollHeight,
      behavior: "smooth",
    });
  }

  function scrollToTop() {
    const container =
      messagesContainerRef.current;

    if (!container) {
      return;
    }

    container.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /* =========================================================
     SEND TEXT MESSAGE
  ========================================================= */

  function sendMessage() {
    const text =
      messageText.trim();

    if (!text) {
      return;
    }

    if (
      !selectedContact ||
      !currentUser
    ) {
      setError(
        "Please select a contact first."
      );

      return;
    }

    const socket =
      socketRef.current;

    if (
      !socket ||
      !socket.connected
    ) {
      setError(
        "Chat connection is not available."
      );

      return;
    }

    setError("");

    socket.emit(
      "send_private_message",
      {
        receiverId:
          selectedContact.id,
        content: text,
        messageType:
          "text",
      },
      (
        response: SocketMessageResponse
      ) => {
        console.log(
          "SEND RESPONSE:",
          response
        );

        if (
          response.success &&
          response.message &&
          typeof response.message !==
            "string"
        ) {
          addIncomingMessage(
            response.message
          );

          setMessageText("");

          setTimeout(() => {
            messageInputRef.current?.focus();
            scrollToBottom();
          }, 50);

          return;
        }

        setError(
          response.error ||
            (typeof response.message ===
            "string"
              ? response.message
              : "Message could not be sent.")
        );
      }
    );
  }

  /* =========================================================
     MESSAGE KEYBOARD
  ========================================================= */

  function handleMessageKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key ===
        "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();

      sendMessage();
    }
  }

  /* =========================================================
     IMAGE PICKER
  ========================================================= */

  function openImagePicker() {
    imageInputRef.current?.click();
  }

  function handleImageSelected(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    if (
      !file.type.startsWith(
        "image/"
      )
    ) {
      setError(
        "Please select an image file."
      );

      event.target.value =
        "";

      return;
    }

    if (
      file.size >
      10 * 1024 * 1024
    ) {
      setError(
        "Image must be smaller than 10 MB."
      );

      event.target.value =
        "";

      return;
    }

    setError("");

    setSelectedImageFile(
      file
    );

    const previewUrl =
      URL.createObjectURL(
        file
      );

    setImagePreview(
      previewUrl
    );
  }

  function cancelImage() {
    if (imagePreview) {
      URL.revokeObjectURL(
        imagePreview
      );
    }

    setImagePreview(null);
    setSelectedImageFile(
      null
    );

    if (
      imageInputRef.current
    ) {
      imageInputRef.current.value =
        "";
    }
  }

  /* =========================================================
     SEND IMAGE
  ========================================================= */

  async function sendImage() {
    if (
      !selectedImageFile ||
      !selectedContact ||
      !currentUser
    ) {
      return;
    }

    const socket =
      socketRef.current;

    if (
      !socket ||
      !socket.connected
    ) {
      setError(
        "Chat connection is not available."
      );

      return;
    }

    setImageSending(
      true
    );

    setError("");

    try {
      const formData =
        new FormData();

      formData.append(
        "image",
        selectedImageFile
      );

      const response =
        await apiFetch(
          `${API_URL}/upload-image`,
          {
            method: "POST",
            body: formData,
          }
        );

      const data =
        (await response.json()) as ImageUploadResponse;

      if (
        !response.ok ||
        !data.success ||
        !data.mediaUrl
      ) {
        throw new Error(
          data.message ||
            "Unable to upload image."
        );
      }

      socket.emit(
        "send_private_message",
        {
          receiverId:
            selectedContact.id,
          content: "",
          messageType:
            "image",
          mediaUrl:
            data.mediaUrl,
        },
        (
          socketResponse: SocketMessageResponse
        ) => {
          console.log(
            "IMAGE SEND RESPONSE:",
            socketResponse
          );

          if (
            socketResponse.success &&
            socketResponse.message &&
            typeof socketResponse.message !==
              "string"
          ) {
            addIncomingMessage(
              socketResponse.message
            );

            cancelImage();

            setTimeout(() => {
              scrollToBottom();
            }, 50);

            return;
          }

          setError(
            socketResponse.error ||
              "Image could not be sent."
          );
        }
      );
    } catch (
      uploadError
    ) {
      console.error(
        "IMAGE ERROR:",
        uploadError
      );

      setError(
        uploadError instanceof
          Error
          ? uploadError.message
          : "Unable to send image."
      );
    } finally {
      setImageSending(
        false
      );
    }
  }

  /* =========================================================
     IMAGE URL
  ========================================================= */

  function getImageUrl(
    mediaUrl?: string | null
  ) {
    if (!mediaUrl) {
      return "";
    }

    if (
      mediaUrl.startsWith(
        "http://"
      ) ||
      mediaUrl.startsWith(
        "https://"
      )
    ) {
      return mediaUrl;
    }

    return `${SOCKET_URL}${mediaUrl}`;
  }

  /* =========================================================
     TIME
  ========================================================= */

  function formatMessageTime(
    createdAt: string
  ) {
    return new Date(
      createdAt
    ).toLocaleTimeString(
      [],
      {
        hour: "numeric",
        minute: "2-digit",
      }
    );
  }

  /* =========================================================
     AUTO SCROLL
  ========================================================= */

  useEffect(() => {
    if (
      !messagesLoading &&
      messages.length > 0
    ) {
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  }, [
    messagesLoading,
    selectedContact,
  ]);

  useEffect(() => {
    if (
      messages.length > 0
    ) {
      setTimeout(() => {
        scrollToBottom();
      }, 50);
    }
  }, [messages]);

  /* =========================================================
     LOGIN / REGISTER SCREEN
  ========================================================= */

  if (
    !token ||
    !currentUser
  ) {
    return (
      <div className="app-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">
              MC
            </div>

            <div>
              <h1>
                Military Connect
              </h1>

              <p>
                Private communication
              </p>
            </div>
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              className={
                authMode ===
                "login"
                  ? "active"
                  : ""
              }
              onClick={() => {
                setAuthMode(
                  "login"
                );

                setError("");
              }}
            >
              Login
            </button>

            <button
              type="button"
              className={
                authMode ===
                "register"
                  ? "active"
                  : ""
              }
              onClick={() => {
                setAuthMode(
                  "register"
                );

                setError("");
              }}
            >
              Create Account
            </button>
          </div>

          <form
            className="auth-form"
            onSubmit={
              handleAuth
            }
          >
            {authMode ===
              "register" && (
              <label>
                Full name

                <input
                  type="text"
                  value={
                    authName
                  }
                  onChange={(
                    event
                  ) =>
                    setAuthName(
                      event
                        .target
                        .value
                    )
                  }
                  placeholder="Your full name"
                  required
                />
              </label>
            )}

            <label>
              Gmail / Email

              <input
                type="email"
                value={
                  authEmail
                }
                onChange={(
                  event
                ) =>
                  setAuthEmail(
                    event
                      .target
                      .value
                  )
                }
                placeholder="name@gmail.com"
                required
              />
            </label>

            <label>
              Password

              <input
                type="password"
                value={
                  authPassword
                }
                onChange={(
                  event
                ) =>
                  setAuthPassword(
                    event
                      .target
                      .value
                  )
                }
                placeholder="Enter your password"
                required
              />
            </label>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            {notice && (
              <div className="notice-message">
                {notice}
              </div>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={
                authLoading
              }
            >
              {authLoading
                ? "Please wait..."
                : authMode ===
                  "login"
                ? "Login"
                : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* =========================================================
     MAIN APP
  ========================================================= */

  return (
    <div className="messenger-app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-mark small">
              MC
            </div>

            <div>
              <strong>
                Military Connect
              </strong>

              <span>
                Private messages
              </span>
            </div>
          </div>

          <button
            type="button"
            className="logout-button"
            onClick={
              logout
            }
          >
            Logout
          </button>
        </div>

        <div className="profile-box">
          <div className="profile-avatar">
            {currentUser.fullName
              .charAt(0)
              .toUpperCase()}
          </div>

          <div>
            <strong>
              {
                currentUser.fullName
              }
            </strong>

            <span>
              {
                currentUser.email
              }
            </span>
          </div>
        </div>

        {/* SEARCH */}

        <form
          className="search-box"
          onSubmit={
            searchUser
          }
        >
          <input
            type="email"
            value={
              searchEmail
            }
            onChange={(
              event
            ) =>
              setSearchEmail(
                event
                  .target
                  .value
              )
            }
            placeholder="Find someone by email..."
          />

          <button
            type="submit"
            disabled={
              searchLoading
            }
          >
            {searchLoading
              ? "..."
              : "Search"}
          </button>
        </form>

        {/* SEARCH RESULTS */}

        {searchResults.length >
          0 && (
          <div className="search-results">
            {searchResults.map(
              (user) => {
                const isAdding =
                  addingContactId ===
                  user.id;

                const alreadyAdded =
                  contacts.some(
                    (
                      contact
                    ) =>
                      contact.id ===
                      user.id
                  );

                return (
                  <div
                    className="search-result"
                    key={
                      user.id
                    }
                  >
                    <div className="contact-avatar">
                      {user.fullName
                        .charAt(
                          0
                        )
                        .toUpperCase()}
                    </div>

                    <div className="contact-info">
                      <strong>
                        {
                          user.fullName
                        }
                      </strong>

                      <span>
                        {
                          user.email
                        }
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={
                        isAdding ||
                        alreadyAdded
                      }
                      onClick={() => {
                        void addContact(
                          user
                        );
                      }}
                    >
                      {isAdding
                        ? "Adding..."
                        : alreadyAdded
                        ? "Added"
                        : "Add"}
                    </button>
                  </div>
                );
              }
            )}
          </div>
        )}

        {/* CONTACTS */}

        <div className="contacts-title">
          <span>
            Conversations
          </span>

          <button
            type="button"
            onClick={() => {
              void loadContacts();
            }}
          >
            ↻
          </button>
        </div>

        <div className="contacts-list">
          {contactsLoading ? (
            <div className="empty-sidebar">
              Loading contacts...
            </div>
          ) : contacts.length ===
            0 ? (
            <div className="empty-sidebar">
              <strong>
                No contacts yet
              </strong>

              <span>
                Search for someone using
                their email address.
              </span>
            </div>
          ) : (
            contacts.map(
              (
                contact
              ) => (
                <button
                  type="button"
                  key={
                    contact.id
                  }
                  className={`contact-item ${
                    selectedContact?.id ===
                    contact.id
                      ? "selected"
                      : ""
                  }`}
                  onClick={() => {
                    void loadConversation(
                      contact
                    );
                  }}
                >
                  <div className="contact-avatar">
                    {contact.fullName
                      .charAt(
                        0
                      )
                      .toUpperCase()}
                  </div>

                  <div className="contact-info">
                    <strong>
                      {
                        contact.fullName
                      }
                    </strong>

                    <span>
                      {
                        contact.email
                      }
                    </span>
                  </div>
                </button>
              )
            )
          )}
        </div>
      </aside>

      {/* =====================================================
          CHAT
      ===================================================== */}

      <main className="chat-area">
        {!selectedContact ? (
          <div className="welcome-screen">
            <div className="welcome-icon">
              💬
            </div>

            <h2>
              Welcome to Military
              Connect
            </h2>

            <p>
              Select a contact to start
              a private conversation.
            </p>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <div className="contact-avatar large">
                {selectedContact.fullName
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div className="chat-header-info">
                <strong>
                  {
                    selectedContact.fullName
                  }
                </strong>

                <span>
                  {
                    selectedContact.email
                  }
                </span>
              </div>
            </header>

            <div
              className="messages-container"
              ref={
                messagesContainerRef
              }
            >
              {messagesLoading ? (
                <div className="messages-loading">
                  <strong>
                    Loading messages...
                  </strong>
                </div>
              ) : messages.length ===
                0 ? (
                <div className="no-messages">
                  <strong>
                    No messages yet
                  </strong>

                  <span>
                    Send a message to
                    start the conversation.
                  </span>
                </div>
              ) : (
                <div className="messages-list">
                  {messages.map(
                    (
                      message
                    ) => {
                      const mine =
                        message.senderId ===
                        currentUser.id;

                      return (
                        <div
                          key={
                            message.id
                          }
                          className={`message-row ${
                            mine
                              ? "mine"
                              : "theirs"
                          }`}
                        >
                          {message.messageType ===
                          "image" ? (
                            <div
                              className={`message-bubble image-bubble ${
                                mine
                                  ? "mine-bubble"
                                  : "theirs-bubble"
                              }`}
                            >
                              <img
                                src={getImageUrl(
                                  message.mediaUrl
                                )}
                                alt="Sent image"
                                className="chat-image"
                              />

                              <span className="message-time">
                                {formatMessageTime(
                                  message.createdAt
                                )}
                              </span>
                            </div>
                          ) : (
                            <div
                              className={`message-bubble ${
                                mine
                                  ? "mine-bubble"
                                  : "theirs-bubble"
                              }`}
                            >
                              <p className="message-text">
                                {
                                  message.content
                                }
                              </p>

                              <span className="message-time">
                                {formatMessageTime(
                                  message.createdAt
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    }
                  )}

                  <div className="messages-end" />
                </div>
              )}

              <div className="chat-scroll-buttons">
                <button
                  type="button"
                  title="Scroll to top"
                  onClick={
                    scrollToTop
                  }
                >
                  ↑
                </button>

                <button
                  type="button"
                  title="Scroll to bottom"
                  onClick={
                    scrollToBottom
                  }
                >
                  ↓
                </button>
              </div>
            </div>

            {(error ||
              notice) && (
              <div
                className={
                  error
                    ? "chat-status error-message"
                    : "chat-status notice-message"
                }
              >
                {error ||
                  notice}
              </div>
            )}

            {imagePreview && (
              <div className="image-preview-area">
                <img
                  src={
                    imagePreview
                  }
                  alt="Preview"
                />

                <div className="image-preview-actions">
                  <button
                    type="button"
                    onClick={
                      cancelImage
                    }
                    disabled={
                      imageSending
                    }
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      void sendImage();
                    }}
                    disabled={
                      imageSending
                    }
                  >
                    {imageSending
                      ? "Sending..."
                      : "Send Image"}
                  </button>
                </div>
              </div>
            )}

            <div className="composer">
              <input
                ref={
                  imageInputRef
                }
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                hidden
                onChange={
                  handleImageSelected
                }
              />

              <button
                type="button"
                className="attach-button"
                title="Send picture"
                onClick={
                  openImagePicker
                }
                disabled={
                  imageSending
                }
              >
                📷
              </button>

              <textarea
                ref={
                  messageInputRef
                }
                value={
                  messageText
                }
                onChange={(
                  event
                ) =>
                  setMessageText(
                    event
                      .target
                      .value
                  )
                }
                onKeyDown={
                  handleMessageKeyDown
                }
                placeholder={`Message ${selectedContact.fullName}...`}
                rows={1}
              />

              <button
                type="button"
                className="send-button"
                onClick={
                  sendMessage
                }
                disabled={
                  !messageText.trim()
                }
              >
                Send
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;