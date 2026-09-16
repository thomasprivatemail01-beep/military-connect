import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import http from "http";
import path from "path";
import fs from "fs";
import multer from "multer";
import { Server as SocketIOServer } from "socket.io";
import pool from "./database";

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 5000;

const JWT_SECRET: string =
  process.env.JWT_SECRET ||
  "military-connect-development-secret";

const FRONTEND_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://military-connect.vercel.app",
];

app.use(
  cors({
    origin: FRONTEND_ORIGINS,
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   TYPES
========================================================= */

interface AuthenticatedRequest extends express.Request {
  userId?: number;
}

interface User {
  id: number;
  fullName: string;
  email: string;
  createdAt: string;
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

interface SocketMessageData {
  receiverId: number;
  content?: string;
  messageType?: "text" | "image";
  mediaUrl?: string;
}

interface SocketMessageResponse {
  success: boolean;
  message?: Message;
  error?: string;
}

/* =========================================================
   SOCKET.IO
========================================================= */

const io = new SocketIOServer(server, {
  cors: {
    origin: FRONTEND_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

/* =========================================================
   UPLOADS
========================================================= */

const uploadDirectory = path.join(
  __dirname,
  "..",
  "uploads"
);

if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, {
    recursive: true,
  });
}

app.use(
  "/uploads",
  express.static(uploadDirectory)
);

const storage = multer.diskStorage({
  destination: (
    _req,
    _file,
    callback
  ) => {
    callback(null, uploadDirectory);
  },

  filename: (
    _req,
    file,
    callback
  ) => {
    const extension = path.extname(
      file.originalname
    );

    const baseName =
      path
        .basename(
          file.originalname,
          extension
        )
        .replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );

    const uniqueName =
      `${Date.now()}-${Math.round(
        Math.random() * 1_000_000_000
      )}-${baseName}${extension}`;

    callback(null, uniqueName);
  },
});

const upload = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024,
  },

  fileFilter: (
    _req,
    file,
    callback
  ) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (
      allowedTypes.includes(
        file.mimetype
      )
    ) {
      callback(null, true);
    } else {
      callback(
        new Error(
          "Only JPG, PNG, GIF, and WEBP images are allowed."
        )
      );
    }
  },
});

/* =========================================================
   AUTH HELPERS
========================================================= */

function createToken(
  userId: number
): string {
  return jwt.sign(
    {
      userId,
    },
    JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
}

function authenticateRequest(
  req: AuthenticatedRequest
): number | null {
  const authorization =
    req.headers.authorization;

  if (
    !authorization ||
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return null;
  }

  const token =
    authorization.substring(7);

  try {
    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      ) as {
        userId?: number;
      };

    if (
      typeof decoded.userId !==
      "number"
    ) {
      return null;
    }

    req.userId = decoded.userId;

    return decoded.userId;
  } catch {
    return null;
  }
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

function formatUser(
  row: any
): User {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    email: row.email,
    createdAt:
      new Date(
        row.created_at
      ).toISOString(),
  };
}

function formatMessage(
  row: any
): Message {
  return {
    id: Number(row.id),
    senderId: Number(
      row.sender_id
    ),
    receiverId: Number(
      row.receiver_id
    ),
    content:
      row.content || "",
    messageType:
      row.message_type ===
      "image"
        ? "image"
        : "text",
    mediaUrl:
      row.media_url || null,
    createdAt:
      new Date(
        row.created_at
      ).toISOString(),
  };
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, contact_user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* -------------------------------------------------------
     MESSAGE MIGRATIONS
  ------------------------------------------------------- */

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS message_type
    VARCHAR(20) NOT NULL DEFAULT 'text'
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS media_url
    TEXT
  `);

  await pool.query(`
    ALTER TABLE messages
    ALTER COLUMN content
    SET DEFAULT ''
  `);

  /* -------------------------------------------------------
     INDEXES
  ------------------------------------------------------- */

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    idx_contacts_user_id
    ON contacts(user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    idx_contacts_contact_user_id
    ON contacts(contact_user_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    idx_messages_sender_receiver
    ON messages(sender_id, receiver_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    idx_messages_receiver_sender
    ON messages(receiver_id, sender_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    idx_messages_created_at
    ON messages(created_at)
  `);

  console.log(
    "Database tables are ready"
  );
}

/* =========================================================
   BASIC ROUTE
========================================================= */

app.get(
  "/",
  (_req, res) => {
    res.json({
      message:
        "Military Connect server is running",
    });
  }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
  "/api/health",
  async (_req, res) => {
    try {
      await pool.query(
        "SELECT 1"
      );

      res.json({
        success: true,
        message:
          "Military Connect backend is running.",
      });
    } catch (error) {
      console.error(
        "Health check error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Database connection failed.",
      });
    }
  }
);

/* =========================================================
   REGISTER
========================================================= */

app.post(
  "/api/register",
  async (req, res) => {
    try {
      const fullName =
        typeof req.body?.fullName ===
        "string"
          ? req.body.fullName.trim()
          : "";

      const email =
        typeof req.body?.email ===
        "string"
          ? req.body.email
              .trim()
              .toLowerCase()
          : "";

      const password =
        typeof req.body?.password ===
        "string"
          ? req.body.password
          : "";

      if (
        !fullName ||
        !email ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Full name, email, and password are required.",
        });
      }

      if (
        password.length < 6
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Password must be at least 6 characters.",
        });
      }

      const existingUser =
        await pool.query(
          `
          SELECT id
          FROM users
          WHERE email = $1
          `,
          [email]
        );

      if (
        existingUser.rows.length >
        0
      ) {
        return res.status(409).json({
          success: false,
          message:
            "An account with this email already exists.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await pool.query(
          `
          INSERT INTO users (
            full_name,
            email,
            password_hash
          )
          VALUES ($1, $2, $3)
          RETURNING
            id,
            full_name,
            email,
            created_at
          `,
          [
            fullName,
            email,
            passwordHash,
          ]
        );

      const user =
        formatUser(
          result.rows[0]
        );

      const token =
        createToken(
          user.id
        );

      return res.status(201).json({
        success: true,
        message:
          "Account created successfully.",
        token,
        user,
      });
    } catch (error) {
      console.error(
        "REGISTER ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to create account.",
      });
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const email =
        typeof req.body?.email ===
        "string"
          ? req.body.email
              .trim()
              .toLowerCase()
          : "";

      const password =
        typeof req.body?.password ===
        "string"
          ? req.body.password
          : "";

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Email and password are required.",
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            password_hash,
            created_at
          FROM users
          WHERE email = $1
          `,
          [email]
        );

      if (
        result.rows.length ===
        0
      ) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid email or password.",
        });
      }

      const userRow =
        result.rows[0];

      const passwordMatches =
        await bcrypt.compare(
          password,
          userRow.password_hash
        );

      if (!passwordMatches) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid email or password.",
        });
      }

      const user =
        formatUser(
          userRow
        );

      const token =
        createToken(
          user.id
        );

      return res.json({
        success: true,
        message:
          "Login successful.",
        token,
        user,
      });
    } catch (error) {
      console.error(
        "LOGIN ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to log in.",
      });
    }
  }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/me",
  async (req, res) => {
    const authenticatedRequest =
      req as AuthenticatedRequest;

    const userId =
      authenticateRequest(
        authenticatedRequest
      );

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Unauthorized.",
      });
    }

    try {
      const result =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            created_at
          FROM users
          WHERE id = $1
          `,
          [userId]
        );

      if (
        result.rows.length ===
        0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "User not found.",
        });
      }

      return res.json({
        success: true,
        user: formatUser(
          result.rows[0]
        ),
      });
    } catch (error) {
      console.error(
        "ME ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load your account.",
      });
    }
  }
);

/* =========================================================
   SEARCH USERS BY EMAIL
========================================================= */

app.get(
  "/api/users/search",
  async (req, res) => {
    const authenticatedRequest =
      req as AuthenticatedRequest;

    const userId =
      authenticateRequest(
        authenticatedRequest
      );

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Unauthorized. Please log in again.",
      });
    }

    try {
      const email =
        typeof req.query.email ===
        "string"
          ? req.query.email
              .trim()
              .toLowerCase()
          : "";

      if (!email) {
        return res.status(400).json({
          success: false,
          message:
            "Please enter an email address.",
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            created_at
          FROM users
          WHERE LOWER(email) = $1
            AND id <> $2
          LIMIT 10
          `,
          [
            email,
            userId,
          ]
        );

      return res.json({
        success: true,
        users: result.rows.map(
          formatUser
        ),
      });
    } catch (error) {
      console.error(
        "SEARCH USERS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to search for users.",
      });
    }
  }
);

/* =========================================================
   ADD CONTACT
========================================================= */

app.post(
  "/api/contacts",
  async (req, res) => {
    const authenticatedRequest =
      req as AuthenticatedRequest;

    const userId =
      authenticateRequest(
        authenticatedRequest
      );

    if (!userId) {
      console.log(
        "ADD CONTACT: unauthorized request"
      );

      return res.status(401).json({
        success: false,
        message:
          "Unauthorized. Please log in again.",
      });
    }

    try {
      console.log(
        "======================================"
      );

      console.log(
        "ADD CONTACT REQUEST"
      );

      console.log(
        "Logged-in user ID:",
        userId
      );

      console.log(
        "Request body:",
        req.body
      );

      const contactUserId =
        Number(
          req.body?.contactUserId
        );

      console.log(
        "Contact user ID:",
        contactUserId
      );

      if (
        !Number.isInteger(
          contactUserId
        ) ||
        contactUserId <= 0
      ) {
        console.log(
          "INVALID CONTACT USER ID"
        );

        return res.status(400).json({
          success: false,
          message:
            "Invalid contact user ID.",
        });
      }

      if (
        contactUserId === userId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "You cannot add yourself.",
        });
      }

      const userResult =
        await pool.query(
          `
          SELECT
            id,
            full_name,
            email,
            created_at
          FROM users
          WHERE id = $1
          `,
          [contactUserId]
        );

      if (
        userResult.rows.length ===
        0
      ) {
        console.log(
          "CONTACT USER DOES NOT EXIST"
        );

        return res.status(404).json({
          success: false,
          message:
            "The user does not exist.",
        });
      }

      const contactUser =
        userResult.rows[0];

      const existingContact =
        await pool.query(
          `
          SELECT id
          FROM contacts
          WHERE user_id = $1
            AND contact_user_id = $2
          LIMIT 1
          `,
          [
            userId,
            contactUserId,
          ]
        );

      if (
        existingContact.rows.length >
        0
      ) {
        console.log(
          `Contact already exists: ${userId} -> ${contactUserId}`
        );

        return res.json({
          success: true,
          alreadyExists: true,
          message:
            "This person is already in your contacts.",
          contact:
            formatUser(
              contactUser
            ),
        });
      }

      const insertResult =
        await pool.query(
          `
          INSERT INTO contacts (
            user_id,
            contact_user_id
          )
          VALUES ($1, $2)
          RETURNING id
          `,
          [
            userId,
            contactUserId,
          ]
        );

      console.log(
        "CONTACT INSERT RESULT:",
        insertResult.rows
      );

      console.log(
        `Contact added successfully: ${userId} -> ${contactUserId}`
      );

      console.log(
        "======================================"
      );

      return res.status(201).json({
        success: true,
        alreadyExists: false,
        message:
          "Contact added successfully.",
        contact:
          formatUser(
            contactUser
          ),
      });
    } catch (error) {
      console.error(
        "======================================"
      );

      console.error(
        "ADD CONTACT ERROR:",
        error
      );

      console.error(
        "======================================"
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to add contact.",
      });
    }
  }
);

/* =========================================================
   GET CONTACTS
========================================================= */

app.get(
  "/api/contacts",
  async (req, res) => {
    const authenticatedRequest =
      req as AuthenticatedRequest;

    const userId =
      authenticateRequest(
        authenticatedRequest
      );

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Unauthorized. Please log in again.",
      });
    }

    try {
      const result =
        await pool.query(
          `
          SELECT
            u.id,
            u.full_name,
            u.email,
            u.created_at
          FROM contacts c
          INNER JOIN users u
            ON u.id = c.contact_user_id
          WHERE c.user_id = $1
          ORDER BY LOWER(u.full_name) ASC
          `,
          [userId]
        );

      return res.json({
        success: true,
        contacts:
          result.rows.map(
            formatUser
          ),
      });
    } catch (error) {
      console.error(
        "GET CONTACTS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load contacts.",
      });
    }
  }
);

/* =========================================================
   GET CONVERSATION
========================================================= */

app.get(
  "/api/messages/:contactId",
  async (req, res) => {
    const authenticatedRequest =
      req as AuthenticatedRequest;

    const userId =
      authenticateRequest(
        authenticatedRequest
      );

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Unauthorized. Please log in again.",
      });
    }

    try {
      const contactId =
        Number(
          req.params.contactId
        );

      if (
        !Number.isInteger(
          contactId
        ) ||
        contactId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid contact ID.",
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            sender_id,
            receiver_id,
            content,
            message_type,
            media_url,
            created_at
          FROM messages
          WHERE
            (
              sender_id = $1
              AND receiver_id = $2
            )
            OR
            (
              sender_id = $2
              AND receiver_id = $1
            )
          ORDER BY created_at ASC, id ASC
          `,
          [
            userId,
            contactId,
          ]
        );

      return res.json({
        success: true,
        messages:
          result.rows.map(
            formatMessage
          ),
      });
    } catch (error) {
      console.error(
        "GET CONVERSATION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load conversation.",
      });
    }
  }
);

/* =========================================================
   UPLOAD IMAGE
========================================================= */

app.post(
  "/api/upload-image",
  async (req, res) => {
    const authenticatedRequest =
      req as AuthenticatedRequest;

    const userId =
      authenticateRequest(
        authenticatedRequest
      );

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Unauthorized. Please log in again.",
      });
    }

    upload.single("image")(
      req,
      res,
      (error) => {
        if (error) {
          console.error(
            "IMAGE UPLOAD ERROR:",
            error
          );

          return res.status(400).json({
            success: false,
            message:
              error instanceof Error
                ? error.message
                : "Unable to upload image.",
          });
        }

        const file =
          req.file;

        if (!file) {
          return res.status(400).json({
            success: false,
            message:
              "No image was selected.",
          });
        }

        const mediaUrl =
          `/uploads/${file.filename}`;

        console.log(
          `Image uploaded by user ${userId}: ${mediaUrl}`
        );

        return res.status(201).json({
          success: true,
          message:
            "Image uploaded successfully.",
          mediaUrl,
        });
      }
    );
  }
);

/* =========================================================
   SOCKET.IO AUTHENTICATION
========================================================= */

io.use(
  (socket, next) => {
    try {
      const token =
        socket.handshake.auth
          ?.token;

      if (
        typeof token !==
        "string" ||
        !token
      ) {
        return next(
          new Error(
            "Authentication required."
          )
        );
      }

      const decoded =
        jwt.verify(
          token,
          JWT_SECRET
        ) as {
          userId?: number;
        };

      if (
        typeof decoded.userId !==
        "number"
      ) {
        return next(
          new Error(
            "Invalid authentication token."
          )
        );
      }

      socket.data.userId =
        decoded.userId;

      return next();
    } catch (error) {
      console.error(
        "SOCKET AUTH ERROR:",
        error
      );

      return next(
        new Error(
          "Invalid or expired token."
        )
      );
    }
  }
);

/* =========================================================
   SOCKET.IO CONNECTION
========================================================= */

io.on(
  "connection",
  (socket) => {
    const userId =
      Number(
        socket.data.userId
      );

    console.log(
      `Socket connected: user ${userId}, socket ${socket.id}`
    );

    socket.join(
      `user:${userId}`
    );

    /* -----------------------------------------------------
       SEND PRIVATE MESSAGE
    ----------------------------------------------------- */

    socket.on(
      "send_private_message",
      async (
        data: SocketMessageData,
        callback?: (
          response: SocketMessageResponse
        ) => void
      ) => {
        try {
          const receiverId =
            Number(
              data?.receiverId
            );

          const content =
            typeof data?.content ===
            "string"
              ? data.content.trim()
              : "";

          const messageType =
            data?.messageType ===
            "image"
              ? "image"
              : "text";

          const mediaUrl =
            typeof data?.mediaUrl ===
            "string"
              ? data.mediaUrl
              : null;

          console.log(
            "SEND MESSAGE:",
            {
              senderId:
                userId,
              receiverId,
              messageType,
              contentLength:
                content.length,
              mediaUrl,
            }
          );

          if (
            !Number.isInteger(
              receiverId
            ) ||
            receiverId <= 0
          ) {
            callback?.({
              success: false,
              error:
                "Invalid receiver.",
            });

            return;
          }

          if (
            receiverId === userId
          ) {
            callback?.({
              success: false,
              error:
                "You cannot message yourself.",
            });

            return;
          }

          if (
            messageType ===
              "text" &&
            !content
          ) {
            callback?.({
              success: false,
              error:
                "Message cannot be empty.",
            });

            return;
          }

          if (
            messageType ===
              "image" &&
            !mediaUrl
          ) {
            callback?.({
              success: false,
              error:
                "Image URL is missing.",
            });

            return;
          }

          const receiverResult =
            await pool.query(
              `
              SELECT id
              FROM users
              WHERE id = $1
              `,
              [receiverId]
            );

          if (
            receiverResult.rows
              .length === 0
          ) {
            callback?.({
              success: false,
              error:
                "The recipient does not exist.",
            });

            return;
          }

          const result =
            await pool.query(
              `
              INSERT INTO messages (
                sender_id,
                receiver_id,
                content,
                message_type,
                media_url
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5
              )
              RETURNING
                id,
                sender_id,
                receiver_id,
                content,
                message_type,
                media_url,
                created_at
              `,
              [
                userId,
                receiverId,
                content,
                messageType,
                mediaUrl,
              ]
            );

          const savedMessage =
            formatMessage(
              result.rows[0]
            );

          console.log(
            "MESSAGE SAVED:",
            savedMessage
          );

          callback?.({
            success: true,
            message:
              savedMessage,
          });

          io.to(
            `user:${receiverId}`
          ).emit(
            "private_message",
            savedMessage
          );
        } catch (error) {
          console.error(
            "SEND PRIVATE MESSAGE ERROR:",
            error
          );

          callback?.({
            success: false,
            error:
              "Unable to send message.",
          });
        }
      }
    );

    /* -----------------------------------------------------
       DISCONNECT
    ----------------------------------------------------- */

    socket.on(
      "disconnect",
      (reason) => {
        console.log(
          `Socket disconnected: user ${userId}, socket ${socket.id}, reason: ${reason}`
        );
      }
    );
  }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(
      "EXPRESS ERROR:",
      error
    );

    if (
      error instanceof multer.MulterError
    ) {
      return res.status(400).json({
        success: false,
        message:
          error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Internal server error.",
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

async function startServer() {
  try {
    await pool.query(
      "SELECT 1"
    );

    console.log(
      "PostgreSQL database connected successfully"
    );

    await initializeDatabase();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Military Connect server running on port ${PORT}`
        );

        console.log(
          `http://localhost:${PORT}`
        );

        console.log(
          `Image uploads: http://localhost:${PORT}/uploads/`
        );
      }
    );
  } catch (error) {
    console.error(
      "FAILED TO START SERVER:"
    );

    console.error(
      error
    );

    process.exit(1);
  }
}

startServer();